# Memory Search & Indexing Internals

> Detailed technical reference for the runtime memory retrieval pipeline.
> For architectural overview, see ARCHITECTURE.md.
> Last updated: 2026-02-22 — facts.db integration + Hebbian activation

---

## System Overview

The memory search pipeline runs inside the **continuity plugin** (`openclaw-plugin-continuity`). Every time the agent receives a message, the plugin's `before_agent_start` hook (priority 10) executes a multi-signal retrieval pipeline and injects results into the prompt as `[CONTINUITY CONTEXT]`.

```
User message arrives
        │
        ▼
┌──────────────────────────────────────────────────────┐
│  before_agent_start (priority 10)                     │
│                                                       │
│  1. Topic tracking + session state                    │
│  2. Strip context blocks from query                   │
│  3. Semantic search (SQLite-vec, 768d)                │
│  4. Keyword search (FTS5 BM25)                        │
│  5. Reciprocal Rank Fusion (3-way)                    │
│  6. Temporal decay reranking                          │
│  7. Facts.db structured search (alias → entity → FTS) │
│  8. Hebbian activation bump + co-occurrence wiring    │
│  9. Build [CONTINUITY CONTEXT] block                  │
│                                                       │
│  Output: { prependContext: string }                   │
└──────────────────────────────────────────────────────┘
        │
        ▼
  Injected before the LLM prompt
```

---

## Databases

### continuity.db

**Location:** `~/.openclaw/extensions/openclaw-plugin-continuity/data/continuity.db`
**Size:** ~23 MB
**Engine:** SQLite + sqlite-vec + FTS5 (via better-sqlite3)

Stores raw conversation exchanges with semantic embeddings.

#### Tables

```sql
-- Core exchange storage
CREATE TABLE exchanges (
    id TEXT PRIMARY KEY,           -- "exchange_YYYY-MM-DD_N"
    date TEXT NOT NULL,            -- "2026-02-22"
    exchange_index INTEGER,        -- sequential within day
    user_text TEXT,                -- what the user said
    agent_text TEXT,               -- what the agent responded
    combined TEXT,                 -- formatted for embedding
    metadata TEXT,                 -- JSON: {timestamp, hasUser, hasAgent}
    created_at TEXT DEFAULT (datetime('now'))
);

-- 768-dimensional vector embeddings (sqlite-vec virtual table)
CREATE VIRTUAL TABLE vec_exchanges USING vec0(
    id TEXT PRIMARY KEY,
    embedding float[768]
);

-- Full-text search index (FTS5 with porter stemmer)
CREATE VIRTUAL TABLE fts_exchanges USING fts5(
    id, user_text, agent_text,
    tokenize='porter unicode61'
);
```

#### Current Scale
| Metric | Value |
|--------|-------|
| Exchanges | 2,529 |
| Distinct days | 6 (Feb 17–22, 2026) |
| Vec rows | 2,529 (100% coverage) |
| FTS5 rows | 2,529 (100% coverage) |
| Embedding dimensions | 768 |
| DB size | 23 MB |

---

### facts.db

**Location:** `~/.openclaw/data/facts.db` (symlinked from `~/clawd/memory/facts.db`)
**Size:** ~660 KB
**Engine:** SQLite + FTS5 (via better-sqlite3)

Stores structured knowledge as entity/key/value triples with Hebbian activation mechanics.

#### Tables

```sql
-- Structured facts with Hebbian columns
CREATE TABLE facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity TEXT NOT NULL,          -- "Janna", "Postiz Stack", "decision"
    key TEXT NOT NULL,             -- "birthday", "url", "social_media_approval"
    value TEXT NOT NULL,           -- "July 7, 1976", "https://postiz..."
    category TEXT NOT NULL,        -- person, project, decision, infrastructure, etc.
    source TEXT,                   -- "metabolism", "MEMORY.md", "corrected by Sascha"
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_accessed TEXT,            -- updated on every retrieval (Hebbian)
    access_count INTEGER DEFAULT 0,-- retrieval frequency (Hebbian)
    permanent BOOLEAN DEFAULT 0,   -- 1 = never decays (birthdays, core decisions)
    decay_score REAL DEFAULT 1.0,  -- multiplicative decay (0.95/day, floor 0.01)
    activation REAL DEFAULT 0.0,   -- cumulative activation score (+0.5 per retrieval)
    importance REAL DEFAULT 0.5    -- retention weight (0.0–1.0)
);

-- Alias resolution (the #1 performance unlock)
CREATE TABLE aliases (
    alias TEXT NOT NULL COLLATE NOCASE,  -- "Mama", "JoJo", "aiserver"
    entity TEXT NOT NULL COLLATE NOCASE, -- "Heidi Kuhlmann-Becker", "Johanna"
    PRIMARY KEY (alias, entity)
);

-- Entity relationships
CREATE TABLE relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL,
    predicate TEXT NOT NULL,
    object TEXT NOT NULL,
    source TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Hebbian co-occurrence wiring
CREATE TABLE co_occurrences (
    fact_a INTEGER NOT NULL,
    fact_b INTEGER NOT NULL,
    weight REAL DEFAULT 1.0,       -- incremented each time both retrieved together
    last_wired TEXT,               -- timestamp of last co-retrieval
    PRIMARY KEY (fact_a, fact_b),
    FOREIGN KEY (fact_a) REFERENCES facts(id),
    FOREIGN KEY (fact_b) REFERENCES facts(id)
);

-- Full-text search with sync triggers
CREATE VIRTUAL TABLE facts_fts USING fts5(
    entity, key, value,
    content=facts,
    content_rowid=id
);

-- FTS on relations
CREATE VIRTUAL TABLE relations_fts USING fts5(
    subject, predicate, object
);
```

#### Current Scale
| Metric | Value |
|--------|-------|
| Facts | 692 |
| Permanent facts | 146 |
| Aliases | 52 |
| Relations | 5 |
| Co-occurrences | 64 (and growing) |
| Categories | 14 (infrastructure, person, project, decision, ...) |
| Sources | metabolism (455), manual/seeded (217) |

---

## Embedding Infrastructure

### llama.cpp Server (Port 8082)

**Model:** `nomic-embed-text-v1.5` (768 dimensions)
**Hardware:** AMD Radeon 8060S GPU (ROCm), 40 CUs, ~580MB VRAM pinned
**Latency:** ~7ms per embedding
**API:** OpenAI-compatible `/v1/embeddings` endpoint

```bash
# Test
curl -s http://localhost:8082/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"input": "search_query: test", "model": "nomic-embed-text-v1.5"}' \
  | jq '.data[0].embedding | length'
# Returns: 768
```

**Important:** nomic-embed-text uses task prefixes:
- Indexing: `search_document: <text>` (used by Indexer)
- Querying: `search_query: <text>` (used by Searcher)

### Fallback Chain
1. **llama.cpp** (GPU, 768d, ~7ms) — primary
2. **@chroma-core/default-embed** (ONNX CPU, 384d) — fallback
3. **@huggingface/transformers** (ONNX CPU, 384d) — last resort

If dimensions change between models, the Indexer detects it, drops the vec table, clears the index log, and triggers a full re-index.

---

## Search Pipeline (Continuity Exchanges)

### 1. Semantic Search (`_semanticSearch`)

Generates a 768d query embedding via llama.cpp, then runs a sqlite-vec MATCH query:

```sql
SELECT e.*, v.distance
FROM vec_exchanges v
JOIN exchanges e ON e.id = v.id
WHERE v.embedding MATCH ?    -- Float32Array query vector
AND k = ?                    -- fetch limit
ORDER BY v.distance ASC      -- lower distance = more similar
```

Returns results ranked by cosine distance (lower = better).

### 2. Keyword Search (`_ftsSearch`)

BM25 full-text search via FTS5:

```sql
SELECT f.id, e.*, bm25(fts_exchanges) AS bm25_score
FROM fts_exchanges f
JOIN exchanges e ON e.id = f.id
WHERE fts_exchanges MATCH ?
ORDER BY bm25(fts_exchanges) ASC  -- more negative = better match
LIMIT ?
```

Query sanitization strips FTS5 operators (`AND`, `OR`, `NOT`, `NEAR`, `*`, `"`, `^`) and wraps each word in quotes for implicit AND matching. Words shorter than 2 characters are filtered out. Porter stemmer handles morphological variants ("running" matches "run").

### 3. Reciprocal Rank Fusion (RRF)

Merges the ranked lists from semantic search, keyword search, and (formerly) graph results:

```
For each document appearing in any list:
  score(doc) = SUM(1 / (k + rank)) across all lists

k = 60 (standard RRF constant — prevents top-ranked docs from dominating)
```

This produces a single fused score where documents appearing in multiple lists rank higher. A document ranked #1 in semantic and #3 in keyword beats a document ranked #1 in semantic but absent from keyword.

### 4. Temporal Decay Reranking

After RRF fusion, a recency boost is applied:

```javascript
recencyBoost = exp(-ageDays / halfLifeDays) * recencyWeight

// Defaults:
halfLifeDays = 14     // half-life of 2 weeks
recencyWeight = 0.15  // recency accounts for ~15% of final score

compositeScore = rrfScore * (1 + recencyBoost)
```

This means a conversation from yesterday about the same topic outranks one from 3 weeks ago, but not by so much that a highly relevant old conversation gets buried.

### 5. Relevance Gating

Results are only injected into the prompt if:
- **Explicit intent detected** (user mentions "remember", "we talked about", "earlier", etc.), OR
- **Top result distance < 1.0** (semantically relevant match)

Otherwise, results are cached for potential `tool_result_persist` enrichment but not injected.

### 6. Output Format

```
[CONTINUITY CONTEXT]
Session: 8 exchanges | Started: 12min ago
Topics: memory (fixated — 5 mentions), plugin (active)

You remember these earlier conversations with this user:
- They told you: "what can you tell me about Janna"
  You said: "Janna Boyd is your girlfriend..."
Speak from this memory naturally. Never say "I don't have information" about things you remember above.

From your knowledge base:
- Janna.birthday = July 7, 1976
- Janna.relationship = Sascha's girlfriend
- Janna.full_name = Janna Boyd
```

---

## Search Pipeline (Facts — Structured Knowledge)

### Module: `facts-searcher.js`

Loaded as a shared instance at plugin startup. Opens facts.db separately from continuity.db.

### Search Phases (Highest Confidence First)

#### Phase 1: Entity + Intent (Score 95)

1. **Extract entity candidates** from the query:
   - Capitalized words: `"Janna"`, `"Home Assistant"`
   - Two/three-word combos: `"Adult in Training"`, `"Microdose Tracker"`
   - Possessive patterns: `"Mama's birthday"` → extract `"Mama"`
   - Self-reference: `"who am I"` → `"Gandalf"`
   - Match against cached alias list (52 aliases, word-boundary matching)

2. **Resolve entity** via alias table:
   ```
   "Mama" → aliases table → "Heidi Kuhlmann-Becker"
   "JoJo" → aliases table → "Johanna"
   "aiserver" → aliases table → (direct entity match)
   ```

3. **Extract intent** from query via regex patterns:
   ```
   "birthday" | "born" | "birth" → intent: "birthday"
   "phone" | "number" | "call"   → intent: "phone"
   "email" | "mail"              → intent: "email"
   "stack" | "tech" | "built"    → intent: "stack"
   ```

4. **Query facts** with entity + intent:
   ```sql
   SELECT id, key, value, source FROM facts
   WHERE entity = 'Heidi Kuhlmann-Becker' AND key LIKE '%birthday%'
   ```
   → Returns: `Heidi Kuhlmann-Becker.birthday = September 1, 1944` (score 95)

#### Phase 2: All Entity Facts (Score 70)

If entity resolved but no specific intent, return all facts for that entity:
```sql
SELECT id, key, value, source FROM facts WHERE entity = ?
```

#### Phase 2b: Entity Relations (Score 65)

```sql
SELECT id, predicate, object, source FROM relations WHERE subject = ?
```

#### Phase 3: FTS5 Fallback on Facts (Score 50)

Only fires if Phases 1–2 found nothing. Builds an OR query from significant words:
```sql
SELECT entity, key, value FROM facts_fts
WHERE facts_fts MATCH '"social" OR "media" OR "approval"'
```

#### Phase 4: FTS5 on Relations (Score 40)

Fills remaining slots with relation matches.

---

## Hebbian Learning Mechanics

### Principle: "Cells that fire together wire together"

Facts that get retrieved frequently become easier to retrieve. Facts that are never accessed gradually fade. Facts that are consistently retrieved together form associative links.

### Activation Bump (On Retrieval)

Every time `facts-searcher.js` returns results, it bumps the retrieved facts:

```sql
UPDATE facts SET
    activation = activation + 0.5,    -- cumulative, no ceiling
    access_count = access_count + 1,  -- lifetime counter
    decay_score = 1.0,                -- reset decay (fully "warm")
    last_accessed = ?                 -- ISO timestamp
WHERE id = ?
```

### Co-Occurrence Wiring (On Retrieval)

Facts retrieved together in the same query get wired bidirectionally:

```sql
INSERT INTO co_occurrences (fact_a, fact_b, weight, last_wired)
VALUES (?, ?, 1.0, datetime('now'))
ON CONFLICT(fact_a, fact_b) DO UPDATE SET
    weight = weight + 1.0,
    last_wired = datetime('now')
```

Example: When you ask about "Janna", facts `birthday`, `phone_mobile`, and `phone_work` are all returned → they get wired together. Next time, retrieving one boosts the others (spreading activation — future enhancement).

### Daily Decay (Maintenance Service)

Runs once per 24 hours via the continuity plugin's maintenance interval:

```sql
-- Initialize NULLs
UPDATE facts SET decay_score = 1.0
WHERE decay_score IS NULL AND (permanent = 0 OR permanent IS NULL);

-- Apply 5% daily decay, floor at 0.01
UPDATE facts SET decay_score = MAX(0.01, decay_score * 0.95)
WHERE permanent = 0 OR permanent IS NULL;
```

**Permanent facts are exempt.** Birthdays, phone numbers, core decisions never decay.

### Stable vs Transient Categories

Not all knowledge decays equally. A server port number from 6 months ago is stale. Your sister's birthday is forever. The system uses category-based permanence:

**Stable categories** (born permanent, never decay, never pruned):
- `person` — relationships, birthdays, phone numbers, addresses
- `pet` — pets don't expire
- `preference` — communication style, food spots, music taste
- `decision` — architectural decisions, legal boundaries
- `psychedelic` — research, integration philosophy, certifications
- `people` — legacy category, same as person

**Transient categories** (decay at 0.95/day, prunable at cap):
- `infrastructure` — server configs, ports, stack details
- `project` — project state, milestones, current status
- `automation` — cron jobs, workflows, integrations
- `convention` — naming conventions, file organization
- `context` — ephemeral situational context
- `tool` — tool configs, versions
- `configuration` — runtime settings

**Implementation:** `insert-facts.js` checks `STABLE_CATEGORIES` on insert and sets `permanent = 1` for stable facts. The daily decay sweep skips all permanent facts. The cap-and-prune logic only evicts non-permanent facts.

**Design rationale:** Hebbian "use it or lose it" is correct for operational knowledge but wrong for relational/identity knowledge. You might not mention a friend for a year — that doesn't mean the friendship decayed.

### Activation Lifecycle

```
New fact inserted (metabolism/manual)
  activation = 0.0, decay_score = 1.0
        │
        ▼  (first retrieval)
  activation = 0.5, access_count = 1, decay_score = 1.0
        │
        ▼  (retrieved again same day)
  activation = 1.0, access_count = 2, decay_score = 1.0
        │
        ▼  (7 days without retrieval)
  activation = 1.0, decay_score = 0.95^7 = 0.698
        │
        ▼  (30 days without retrieval)
  activation = 1.0, decay_score = 0.95^30 = 0.215
        │
        ▼  (retrieved again!)
  activation = 1.5, access_count = 3, decay_score = 1.0 (reset!)
```

---

## Indexing Pipeline

### Exchange Indexing (Indexer)

The `Indexer` class processes daily conversation archives into the search indices.

**Trigger:** Maintenance service runs every 5 minutes, checks for un-indexed dates.

**Process:**
1. Read JSONL archive file for the date
2. Pair messages into user→agent exchanges
3. Format each exchange: `[YYYY-MM-DD HH:MM]\nUser: ...\nAgent: ...`
4. Generate 768d embedding via llama.cpp (`search_document:` prefix)
5. Truncate to 6,000 chars before embedding (~1,500 tokens)
6. Insert into `exchanges`, `vec_exchanges`, and `fts_exchanges` (single transaction)
7. Mark date as indexed in `index-log.json`

### Facts Ingestion

**Sources:**
| Source | Count | Quality | Method |
|--------|-------|---------|--------|
| Metabolism plugin | 455 | Mixed — includes noise | Auto-extraction from conversations |
| Manual seeding | ~80 | High | `scripts/seed-facts.py` |
| File recovery | 79 | High | `recovered from continuity` |
| MEMORY.md | 29 | High | Extracted from curated memory |
| TOOLS.md | 9 | High | Infrastructure facts |
| Corrected by Sascha | 5 | Highest | Human-verified corrections |

**Quality concern:** Metabolism auto-generates facts from conversations. Some are noise (e.g., `"Meeting_ID / 86169790775 = string"`, `"Topic / candidates = 6 mentions"`). The 146 permanent facts are the high-quality core. Metabolism quality gate improvement is pending.

---

## Plugin Stack (Active)

| Plugin | Priority | Hook | Injects | Database |
|--------|----------|------|---------|----------|
| **Stability** | 5 | `before_agent_start` | `[STABILITY CONTEXT]` | In-memory |
| **Continuity** | 10 | `before_agent_start` | `[CONTINUITY CONTEXT]` + knowledge base | continuity.db + facts.db |
| **Metabolism** | 50 | `after_agent_end` | (writes to facts.db) | facts.db |

**Removed (2026-02-22):**
- `openclaw-plugin-graph` (CoderofTheWest) — replaced by facts-searcher.js inside continuity
- Reason: facts.db + graph-search achieved 100% recall on benchmark; skillgraph.db had data quality issues (49% CONCEPT entities, 17% `related_to` predicates)

---

## Benchmark Results

60-query benchmark across 7 categories (PEOPLE, TOOLS, PROJECTS, FACTS, OPERATIONAL, IDENTITY, DAILY).

| Method | Score | Speed |
|--------|-------|-------|
| QMD BM25 only | 28/60 (46.7%) | ~10s |
| Graph (facts.db) only | 33/60 (55.0%) | ~2s |
| Hybrid (graph + BM25) | 40/60 (66.7%) | ~15s |
| + entity seeding | 43/60 (71.7%) | ~15s |
| + doc entities + alias tuning | 54/60 (90.0%) | ~15s |
| **+ event entities + edge cases** | **60/60 (100%)** | ~15s |

**Key insight:** Structure > Embeddings. The graph layer with 139 facts, 109 aliases, and 82 relations outperformed vector search with 955 embedded chunks. Alias resolution was the #1 unlock.

---

## File Locations

```
~/.openclaw/extensions/openclaw-plugin-continuity/
├── index.js                    # Main plugin (hooks, context building)
├── storage/
│   ├── archiver.js             # JSONL conversation archive
│   ├── indexer.js              # Exchange → embedding → SQLite-vec
│   ├── searcher.js             # Hybrid search (semantic + FTS5 + RRF)
│   └── facts-searcher.js       # Structured facts search + Hebbian (NEW)
├── services/
│   └── maintenance.js          # Periodic indexing + pruning + decay
├── lib/
│   ├── topic-tracker.js        # Active/fixated/fading topic detection
│   ├── continuity-anchors.js   # Identity moments, contradictions
│   └── token-estimator.js      # Token budget calculation
└── data/
    ├── continuity.db           # Exchange archive + vectors
    ├── archive/                # Daily JSONL conversation logs
    └── index-log.json          # Which dates have been indexed

~/.openclaw/data/
└── facts.db                    # Structured knowledge (symlinked from ~/clawd/memory/)

~/clawd/scripts/
├── graph-search.py             # Original Python search (benchmark tool, not runtime)
├── graph-decay.py              # Standalone decay script (superseded by maintenance.js)
├── init-facts-db.py            # Schema initialization
├── seed-facts.py               # Manual fact seeding
├── query-facts.py              # CLI fact queries
└── memory-benchmark.py         # 60-query benchmark runner
```

---

## Changelog

### 2026-02-22: facts.db Integration + Hebbian Activation

- **Added:** `facts-searcher.js` — Node.js port of graph-search.py
- **Added:** Hebbian activation bump on every fact retrieval (+0.5 activation, reset decay_score)
- **Added:** Co-occurrence wiring between facts retrieved together
- **Added:** Daily decay (0.95/day) in continuity maintenance service
- **Added:** `"From your knowledge base:"` injection in `[CONTINUITY CONTEXT]`
- **Removed:** CoderofTheWest graph plugin (`openclaw-plugin-graph`)
- **Removed:** `global.__ocGraph` bus (no longer needed)
- **Net result:** 4 plugins → 4 plugins (graph replaced by integrated facts search), better data quality, Hebbian mechanics activated

### 2026-02-20: Embedding Migration

- Migrated from ONNX CPU (384d) to llama.cpp GPU (768d)
- Model: nomic-embed-text-v1.5 via llama.cpp server on port 8082
- Rebuilt all vector indices
- 70x latency improvement (500ms → 7ms)

### 2026-02-17: Initial Continuity Plugin

- SQLite-vec conversation archive
- Hybrid search (semantic + FTS5 + RRF)
- Topic tracking, continuity anchors
- Context budgeting
