# Memory Architecture — Gandalf's Cognitive System

> How memory works, why it's built this way, and how the pieces fit together.

## Overview

Gandalf's memory is a multi-layered system designed to survive session resets, context compaction, and model switches. No single layer handles everything — each serves a different query pattern and lifetime.

```
┌─────────────────────────────────────────────────────────┐
│                   SESSION CONTEXT                        │
│            (conversation + tool outputs)                  │
│                  ~200K token window                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│   │ active-      │  │  MEMORY.md   │  │  USER.md     │ │
│   │ context.md   │  │  (strategic) │  │  (identity)  │ │
│   │ (working     │  │              │  │              │ │
│   │  memory)     │  │  Long-term   │  │  Who your    │ │
│   │              │  │  curated     │  │  human is,   │ │
│   │  What's hot  │  │  wisdom      │  │  family,     │ │
│   │  RIGHT NOW   │  │              │  │  projects    │ │
│   └──────┬───────┘  └──────┬───────┘  └──────────────┘ │
│          │                 │                             │
│   ┌──────┴─────────────────┴──────────────────────────┐ │
│   │         KNOWLEDGE GRAPH (SQLite + FTS5)            │ │
│   │  facts.db + relations + aliases + co_occurrences   │ │
│   │  Entity resolution → intent matching → lookup      │ │
│   │  Activation scoring + decay system (Hot/Warm/Cool) │ │
│   └──────┬─────────────────┬──────────────────────────┘ │
│          │                 │                             │
│   ┌──────┴─────────────────┴──────────────────────────┐ │
│   │              SEMANTIC SEARCH                       │ │
│   │  QMD (BM25 + reranking) — primary                  │ │
│   │  llama.cpp nomic-embed-text-v2-moe (768d) — GPU   │ │
│   │  Multilingual: 100+ languages (German-friendly)    │ │
│   └──────┬─────────────────┬──────────────────────────┘ │
│          │                 │                             │
│   ┌──────┴───────┐  ┌─────┴────────┐  ┌─────────────┐ │
│   │ facts.db     │  │ YYYY-MM-DD   │  │ tools-*.md  │ │
│   │ (structured) │  │ .md (daily)  │  │ (procedural)│ │
│   │              │  │              │  │             │ │
│   │ Entity/key/  │  │ Raw session  │  │ Runbooks,   │ │
│   │ value lookup │  │ logs, what   │  │ API creds,  │ │
│   │ + relations  │  │ happened     │  │ how-to      │ │
│   └──────────────┘  └──────────────┘  └─────────────┘ │
│                                                          │
│   ┌──────────────────────────────────────────────────┐  │
│   │       DOMAIN RAG (Integration Coaching)           │  │
│   │  Ebooks RAG — 4,361 chunks, 27 documents          │  │
│   │  5-MeO-DMT guides, integration literature         │  │
│   │  Weekly reindex via cron                          │  │
│   └──────────────────────────────────────────────────┘  │
│                                                          │
│   ┌──────────────────────────────────────────────────┐  │
│   │            PROJECT MEMORY                         │  │
│   │  memory/project-{slug}.md per project             │  │
│   │  Agent-independent institutional knowledge:       │  │
│   │  decisions, lessons, conventions, risks           │  │
│   └──────────────────────────────────────────────────┘  │
│                                                          │
├─────────────────────────────────────────────────────────┤
│             RUNTIME PLUGIN LAYERS (10-12)                │
├─────────────────────────────────────────────────────────┤
│   ┌──────────────────────────────────────────────────┐  │
│   │ CONTINUITY PLUGIN                                 │  │
│   │ Cross-session archive (SQLite + sqlite-vec)       │  │
│   │ 768d embeddings (nomic-embed-text-v2-moe)        │  │
│   │ Topic tracking · Continuity anchors               │  │
│   │ Context budgeting · Priority-tiered compaction    │  │
│   │ Injects: [CONTINUITY CONTEXT] per prompt          │  │
│   └──────────────────────────────────────────────────┘  │
│   ┌──────────────────────────────────────────────────┐  │
│   │ STABILITY PLUGIN                                  │  │
│   │ Entropy monitoring (0.0 stable → 1.0+ drift)      │  │
│   │ Principle alignment (from SOUL.md Core Principles)│  │
│   │ Loop detection · Confabulation detection          │  │
│   │ Injects: [STABILITY CONTEXT] per prompt           │  │
│   └──────────────────────────────────────────────────┘  │
│   ┌──────────────────────────────────────────────────┐  │
│   │ GRAPH-MEMORY PLUGIN                               │  │
│   │ before_agent_start hook                           │  │
│   │ Entity extraction + matching (score ≥ 65)         │  │
│   │ Injects: [GRAPH MEMORY] per prompt                │  │
│   │ Zero API cost, ~2s latency                        │  │
│   └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Agent Team

This architecture runs on a production deployment with **14 OpenClaw agents**. Key agents referenced throughout:

| Agent | Role | Memory behavior |
|-------|------|----------------|
| **Gandalf** | Main personal assistant (Telegram) | Owns MEMORY.md + USER.md. Only agent that loads personal context. Runs heartbeats. |
| **Pete** | Project Manager | Maintains `project-{slug}.md` at phase close. Coordinates dev and QA agents. |
| **Toby** | Lead Developer | Pulls tasks from backlog, writes code, submits to QA. Resets often — relies on project memory. |
| **Beta-tester** | QA Agent | Tests deliverables against success criteria. Reads project memory + dev standards. |
| **Ram Dass** | Wisdom / integration coach (Discord) | Separate persona, own SOUL.md with "presence, loving awareness, truth" principles. |

Each agent has its own session, SOUL.md, and principle set. When an agent resets or compacts, it loses session history — but file-based memory (Layers 1–9) and plugin memory (Layers 10–12) persist.

## Data Isolation & Trust Boundaries

**Current model: Single-human, shared knowledge.**

| Memory Layer | Isolation | Notes |
|-------------|-----------|-------|
| Continuity (conversation history) | **Per-agent** | Each agent's conversation DB is scoped by `agentId`. Agent A cannot retrieve Agent B's conversations. |
| facts.db (structured knowledge) | **Shared** | All agents query the same facts.db. A fact about "Sascha" is visible to every agent. |
| File-vec (workspace documents) | **Shared** | All agents index the same workspace directory tree. |
| MEMORY.md / USER.md | **Per-agent** (by convention) | Only the main agent loads these. Other agents could read them — it's file-level, not enforced. |
| Daily notes (memory/*.md) | **Shared** | All agents can read/write daily notes. No namespace enforcement. |

### Security Implications

**Prompt injection via stored conversations:** Continuity injects raw `userText` and `agentText` into the next session's context without sanitization. In a single-user setup, this is low risk — you're injecting your own past words. In a multi-user or multi-tenant deployment, a malicious user could store prompt injection payloads in conversation history that surface in future sessions.

**Cross-agent knowledge leakage:** facts.db and file-vec are shared. If Agent A learns something sensitive (e.g., from a private Discord channel), it becomes queryable by Agent B. This is currently a feature (shared knowledge = smarter agents) but becomes a liability in multi-tenant deployments.

### Future Design Fork

For distributing this architecture to other OpenClaw users, the key decision is:

1. **Fully isolated** — each agent gets its own facts.db, file-vec index, daily notes. Safest, simplest trust model. Agents are independent.
2. **Fully shared** — current model. All agents share all knowledge. Most capable. Requires trusting all agents equally.
3. **Scoped sharing** — agents opt into knowledge namespaces. Personal facts shared, project facts scoped per team, sensitive facts isolated. Most flexible but most complex.

This decision should be made before shipping multi-agent deployments. For single-human setups (the current use case), fully shared is correct.

## Layers

### Layer 1: Always-Loaded Context

**Files loaded every session start, no questions asked.**

| File | Purpose | Size Target | Update Frequency |
|------|---------|-------------|-----------------|
| `SOUL.md` | Agent identity — personality, voice, values, principles | <2KB | Rarely (with human's knowledge) |
| `USER.md` | Who the human is — family, projects, preferences | <3KB | When new info learned |
| `IDENTITY.md` | Quick identity card (name, emoji, vibe) | <0.5KB | Rarely |
| `memory/active-context.md` | Working memory — what's hot right now | <2KB | End of every significant session |
| `HEARTBEAT.md` | Periodic check instructions | <1KB | As needed |

**Token budget:** ~2,000 tokens total for always-loaded files. Keep them lean.

### Layer 2: Strategic Memory (MEMORY.md — Main Session Only)

| File | Purpose | Size Target | Update Frequency |
|------|---------|-------------|-----------------|
| `MEMORY.md` | Long-term curated wisdom — lessons, insights, key events | <8KB | During heartbeat memory maintenance |

**Rules:**
- Only loaded in main session (direct chat with your human)
- Never loaded in shared contexts (Discord, group chats) — security
- Reviewed and pruned every few days during heartbeat maintenance
- Daily files get distilled into MEMORY.md, not dumped wholesale

### Layer 3: Project Memory (Cross-Agent, Per-Project)

**`memory/project-{slug}.md`** — Institutional knowledge per project.

**What goes here:**
- Architecture decisions (distilled, not raw DB dumps)
- Lessons learned the hard way
- Conventions that emerged during development
- Known risks and active concerns
- Workflow patterns (status flow, QA process, design-first rules)

**What does NOT go here:**
- Backlog items, current status, sprint state → that's the DB or task tracker
- Raw daily logs → that's `YYYY-MM-DD.md`
- Personal context → that's `MEMORY.md` or `USER.md`

### Layer 4: Structured Facts (SQLite + FTS5)

**`~/.openclaw/data/facts.db`** — Single source of truth. Entity/key/value store for precise lookups.

> **v2.2 change:** Consolidated from dual-DB (workspace + core) to single DB at `~/.openclaw/data/facts.db`. Both continuity (reads) and metabolism (writes) use this path. The old `~/clawd/memory/facts.db` no longer exists.

**14 enforced categories:**
- People: `person`, `family`, `friend`, `pet`
- Knowledge: `psychedelic`, `reference`
- Tech: `project`, `infrastructure`, `tool`
- Decisions: `decision`, `preference`, `convention`
- Ops: `automation`, `workflow`

Born permanent: `family`, `friend`, `person`, `pet`, `psychedelic`, `decision`, `preference`

```sql
CREATE TABLE facts (
    id INTEGER PRIMARY KEY,
    entity TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    category TEXT NOT NULL,       -- enforced: 14 valid categories
    source TEXT,
    created_at TEXT NOT NULL,
    permanent BOOLEAN DEFAULT 0,
    decay_score REAL DEFAULT 1.0,
    activation REAL DEFAULT 0.0,  -- Hebbian: bumped on retrieval
    importance REAL DEFAULT 0.5,  -- retention weight
    access_count INTEGER DEFAULT 0
);

CREATE TABLE relations (
    subject TEXT NOT NULL,
    predicate TEXT NOT NULL,
    object TEXT NOT NULL,
    source TEXT DEFAULT 'metabolism',
    category TEXT DEFAULT 'person',
    permanent BOOLEAN DEFAULT 1,
    activation REAL DEFAULT 0.0,
    decay_score REAL DEFAULT 1.0
);

CREATE TABLE aliases (
    alias TEXT NOT NULL COLLATE NOCASE,
    entity TEXT NOT NULL COLLATE NOCASE,
    PRIMARY KEY (alias, entity)
);

CREATE TABLE facts_changelog (  -- audit trail
    entity TEXT, key TEXT, operation TEXT,
    old_value TEXT, new_value TEXT, source TEXT, timestamp TEXT
);
    entity TEXT NOT NULL
);

CREATE TABLE co_occurrences (
    fact_a TEXT NOT NULL,
    fact_b TEXT NOT NULL,
    weight REAL NOT NULL
);

CREATE VIRTUAL TABLE facts_fts USING fts5(entity, key, value, content=facts);
```

**Query patterns:**
- `SELECT * FROM facts WHERE entity='Partner' AND key='birthday'` → instant, exact
- `SELECT * FROM facts_fts WHERE facts_fts MATCH 'birthday'` → full-text search
- Graph traversal via relations table

**Activation/Decay System:**
- `activation` column tracks access frequency and recency
- **Hot (>2.0):** Highly accessed, always retrieved
- **Warm (1.0-2.0):** Moderately accessed
- **Cool (<1.0):** Rarely accessed, may be pruned
- Daily decay cron at 3 AM: `scripts/graph-decay.py`

**Current scale:** 3,108 facts, 1,009 relations, 275 aliases

### Layer 5: Semantic Search

Two-tier search with automatic fallback:

**Primary: QMD**
- Backend: BM25 + reranking + query expansion
- Strengths: Reranking produces high-quality results
- Timeout: 5000ms

**Fallback: llama.cpp (GPU-accelerated)**
- Model: `nomic-embed-text-v2-moe.Q6_K.gguf`
- Dimensions: 768
- Latency: ~7ms average
- **Multilingual:** 100+ languages including German
- VRAM: ~580MB pinned (never unloads)

**Key upgrade (Feb 2026):**
- **Old:** ONNX CPU, 384d, all-MiniLM-L6-v2, ~500ms latency
- **New:** llama.cpp GPU, 768d, nomic-embed-text-v2-moe, ~7ms latency
- **70x faster**, multilingual support

### Layer 5a: Domain RAG (Ebooks)

**`media/Ebooks/.rag/ebook_rag.db`** — Domain-specific RAG for integration coaching.

| Metric | Value |
|--------|-------|
| Chunks | 4,361 |
| Documents | 27 |
| Size | 74 MB |
| Content | 5-MeO-DMT guides, integration literature, blog posts |

**Weekly cron:** Sundays at 3:30 AM via `scripts/ebook-rag-update.sh`

**Use case:** Semantic search over integration coaching materials — "What does Martin Ball say about nondual consciousness?" or "contraindications for 5-MeO-DMT"

**Current limitation:** Uses brute-force cosine similarity (no sqlite-vec index). Should be upgraded to match Continuity's vector indexing.

### Layer 6: Daily Logs (Tactical)

**`memory/YYYY-MM-DD.md`** — Raw session logs. What happened today.

**Importance tagging:**
```markdown
- [decision|i=0.9] Switched to nomic-embed-text-v2-moe
- [lesson|i=0.7] llama.cpp requires prefixes for v2 model
- [context|i=0.3] Routine maintenance
```

**Retention:**
- i ≥ 0.8: Permanent (structural)
- 0.4 ≤ i < 0.8: 30 days (potential)
- i < 0.4: 7 days (contextual)

### Layer 7: Procedural Memory (Runbooks)

**`memory/tools-*.md`** — How to do things.

### Layer 8: Gating Policies

**`memory/gating-policies.md`** — Numbered failure prevention rules.

### Layer 9: Pre-Flight Checkpoints

**`memory/checkpoints/`** — State saves before risky operations.

### Layer 10: Continuity Plugin (Runtime)

**`openclaw-plugin-continuity`** — Cross-session conversation memory.

| Component | Purpose | Storage |
|-----------|---------|---------|
| Conversation archive | Stores all exchanges with embeddings | SQLite + sqlite-vec (768d) |
| Topic tracking | Detects active, fixated, fading topics | In-memory, injected per prompt |
| Continuity anchors | Preserves identity moments, contradictions | In-memory, max 15, 2h TTL |
| Context budgeting | Priority-tiered token allocation | Configurable pool ratios |

**Data:** `~/.openclaw/extensions/continuity/data/continuity.db`
**Current scale:** 2,065 exchanges

### Layer 11: Stability Plugin (Runtime)

**`openclaw-plugin-stability`** — Behavioral monitoring and drift prevention.

| Component | Purpose |
|-----------|---------|
| Entropy monitoring | Tracks conversation coherence (0.0–1.0+) |
| Principle alignment | Matches behavior against SOUL.md principles |
| Loop detection | Catches tool loops and file re-reads |
| Confabulation detection | Flags temporal mismatches, quality decay |

### Layer 12: Graph-memory Plugin (Runtime)

**`openclaw-plugin-graph-memory`** — Automatic entity injection.

| Component | Purpose |
|-----------|---------|
| before_agent_start hook | Runs before each LLM call |
| Entity extraction | Matches query against facts.db |
| [GRAPH MEMORY] injection | Prepends matching entities to prompt |

**Performance:**
- Latency: ~2s
- API cost: $0 (fully local)
- Filtering: Only injects when score ≥ 65

---

## Embedding Infrastructure

| Component | Model | Dimensions | Latency | Notes |
|-----------|-------|------------|---------|-------|
| Primary search | QMD | — | ~4s | BM25 + reranking |
| Fallback/embeddings | nomic-embed-text-v2-moe | 768 | ~7ms | GPU, multilingual |
| Continuity | nomic-embed-text-v2-moe | 768 | ~7ms | sqlite-vec |
| Ebooks RAG | nomic-embed-text-v2-moe | 768 | ~7ms | Brute-force search |

**Hardware (aiserver):**

| Component | Spec |
|-----------|------|
| CPU | AMD Ryzen AI MAX+ 395 — 16 cores / 32 threads |
| RAM | 32GB DDR5 (unified with GPU) |
| GPU | AMD Radeon 8060S — 40 CUs, 96GB unified VRAM |
| Storage | 1.9TB NVMe |
| OS | Ubuntu 25.10 |

**llama.cpp Docker (port 8082):**
```yaml
image: llama.cpp:server-rocm
command: >
  -m /models/nomic-embed-text-v2-moe.Q6_K.gguf
  --host 0.0.0.0 --port 8080
  --embeddings --pooling mean
  -ngl 999 -c 2048 -t 4
environment:
  ROCBLAS_USE_HIPBLASLT: "1"
  HSA_OVERRIDE_GFX_VERSION: "11.5.1"
```

---

## Information Flow

### Upward (Consolidation)
```
Daily logs → active-context.md → MEMORY.md → facts.db
(raw)        (working memory)    (curated)   (structured)

Session work → phase close → project-{slug}.md
(ephemeral)   (PM gate)      (institutional)
```

### Session Boot Sequence

**Main agent (Gandalf):**
```
1. Read SOUL.md (who am I)
2. Read USER.md (who am I helping)
3. Read memory/active-context.md (what's hot)
4. Read memory/YYYY-MM-DD.md (today + yesterday)
5. Read MEMORY.md
6. [On demand] memory_search for specific recalls
7. [On demand] facts.db for structured lookups
```

**Project agents (Toby, Pete, Beta-tester, etc.):**
```
1. Read memory/project-{slug}.md (institutional knowledge — FIRST)
2. Read SOUL.md / IDENTITY.md (who am I)
3. Agent-specific boot steps
4. Read memory/YYYY-MM-DD.md (today) for recent context
```

---

## Changelog

### v6.1 — Metabolism Consolidation (2026-03-05)

**insert-facts.js is now the sole insert path:**
- Retired `insert-facts.py` — JS runs in-process with no spawn overhead
- Ported all Python guardrails to JS: VALID_CATEGORIES strict allowlist, numeric value filter, entity min length
- Added 16 additional blocked keys (gateway_status, node_status, model_setting, etc.)
- Total guardrails: 13 (up from 10)

**Growth vector pipeline fixed:**
- Root cause: in-gateway heartbeat processing never fired — candidates queued but never processed
- Actual processing done by `metabolism-cron.js` (every 5 min), which lacked growth vector write logic
- Fix: Added growth vector collection and file write to `metabolism-cron.js`
- Growth vectors now flow to `memory/growth-vectors.json` → OMA Dashboard

**Metabolism fork:**
- Plugin forked to `coolmanns/openclaw-plugin-metabolism` (upstream: `CoderofTheWest`)
- All customizations (guardrails, config, processor) committed to fork

### v6.0 — Embedding Migration + Graph Plugin (2026-02-20)

**Embedding stack migration:**
- Migrated from ONNX CPU (384d) to llama.cpp GPU (768d)
- Model: `nomic-embed-text-v2-moe.Q6_K.gguf`
- Latency: 500ms → 7ms (70x faster)
- Added multilingual support (100+ languages, German-friendly)
- Rebuilt all Continuity vector indices with 768d

**Graph-memory plugin:**
- New Layer 12: hooks `before_agent_start`
- Injects `[GRAPH MEMORY]` per prompt
- Entity matching with score filtering (≥65)
- Zero API cost, ~2s latency

**Activation/decay system:**
- New columns: `activation`, `importance` on facts
- New table: `co_occurrences` for entity wiring
- Decay cron: daily at 3 AM via `scripts/graph-decay.py`
- Tiers: Hot (>2.0), Warm (1.0-2.0), Cool (<1.0)

**Domain RAG:**
- Added Layer 5a: Ebooks RAG for integration coaching
- 4,361 chunks, 27 documents
- Weekly cron reindex

**Scale updates:**
- facts.db: 3,108 facts, 1,009 relations, 275 aliases
- Continuity: 2,065 exchanges
- Telemetry: 571 entries

---

### v5.0 — Pipeline Integration + Auto-Ingestion (2026-02-18)

- OpenClaw plugin (`plugin/`) for graph-memory
- Auto-ingestion script (`scripts/graph-ingest-daily.py`)
- Context optimization guide (`docs/context-optimization.md`)
- Benchmark: 100% (60/60) hybrid search

---

### v4.0 — Knowledge Graph Layer (2026-02-17)

- SQLite-based entity/relationship store
- 60-query benchmark
- Graph viewer

---

### v3.0 — Hybrid Search (2026-02-15)

- QMD BM25 + vector search

---

### v2.0 — Continuity Plugin (2026-02-14)

- Conversation archive with semantic search

---

### v1.0 — Initial Architecture (2026-02-10)

- MEMORY.md + daily files pattern
- Active-context.md working memory
- Gating policies
