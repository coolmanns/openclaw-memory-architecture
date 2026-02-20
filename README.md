# OpenClaw Memory Architecture

A multi-layered memory system for OpenClaw agents that combines structured storage, semantic search, and cognitive patterns to give your agent persistent, reliable memory.

**The problem:** AI agents wake up fresh every session. Context compression eats older messages mid-conversation. Your agent forgets what you told it yesterday.

**The solution:** Don't rely on one approach. Use the right memory layer for each type of recall.

## Why Not Just Vector Search?

Vector search (embeddings) is great for fuzzy recall — *"what were we talking about regarding infrastructure?"* — but it's overkill for 80% of what a personal assistant actually needs:

- "What's my daughter's birthday?" → **Structured lookup** (instant, exact)
- "What did we decide about the database?" → **Decision fact** (instant, exact)
- "What happened last week with the deployment?" → **Semantic search** (fuzzy, slower)

This architecture uses **each tool where it's strongest**.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                  SESSION CONTEXT                      │
│            (~200K token window)                        │
├──────────────────────────────────────────────────────┤
│                                                       │
│  ┌────────────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ active-context │  │ MEMORY   │  │   USER.md    │ │
│  │ .md            │  │ .md      │  │              │ │
│  │                │  │          │  │  Who your    │ │
│  │ Working memory │  │ Curated  │  │  human is    │ │
│  │ What's hot NOW │  │ wisdom   │  │              │ │
│  └───────┬────────┘  └────┬─────┘  └──────────────┘ │
│          │                │                           │
│  ┌───────┴────────────────┴────────────────────────┐ │
│  │          KNOWLEDGE GRAPH (SQLite)                │ │
│  │   facts.db + relations + aliases + FTS5          │ │
│  │   Entity resolution → intent matching → lookup   │ │
│  └───────┬────────────────┬────────────────────────┘ │
│          │                │                           │
│  ┌───────┴────────────────┴────────────────────────┐ │
│  │            SEMANTIC SEARCH                       │ │
│  │   QMD / Ollama / OpenAI embeddings              │ │
│  └───────┬────────────────┬────────────────────────┘ │
│          │                │                           │
│  ┌───────┴──────┐  ┌─────┴──────┐  ┌─────────────┐ │
│  │  facts.db    │  │ YYYY-MM-DD │  │ gating-     │ │
│  │  (SQLite +   │  │ .md (daily │  │ policies.md │ │
│  │   FTS5)      │  │  logs)     │  │ (failure    │ │
│  │              │  │            │  │  rules)     │ │
│  │  Structured  │  │  Raw       │  │             │ │
│  │  facts       │  │  events    │  │  GP-001...  │ │
│  └──────────────┘  └────────────┘  └─────────────┘ │
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │           PROJECT MEMORY                          │ │
│  │  memory/project-{slug}.md per project             │ │
│  │  Agent-independent institutional knowledge:       │ │
│  │  decisions, lessons, conventions, risks            │ │
│  │  Created by wizard · Read by all agents at boot   │ │
│  │  Updated by PM at phase close                     │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  ┌──────────────┐  ┌──────────────┐                  │
│  │ tools-*.md   │  │ checkpoints/ │                  │
│  │ (runbooks)   │  │ (pre-flight) │                  │
│  └──────────────┘  └──────────────┘                  │
│                                                       │
├──────────────────────────────────────────────────────┤
│              PLUGIN LAYERS (10–11)                    │
├──────────────────────────────────────────────────────┤
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │         CONTINUITY PLUGIN                         │ │
│  │  Cross-session conversation archive               │ │
│  │  SQLite-vec semantic search (384d embeddings)     │ │
│  │  Topic tracking & fixation detection              │ │
│  │  Continuity anchors (identity, contradiction)     │ │
│  │  Context budgeting (priority-tiered compaction)   │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │         STABILITY PLUGIN                          │ │
│  │  Entropy monitoring (drift detection)             │ │
│  │  Principle alignment (from SOUL.md)               │ │
│  │  Loop detection (tool + file re-read guards)      │ │
│  │  Heartbeat decision framework                     │ │
│  │  Confabulation detection                          │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
└──────────────────────────────────────────────────────┘
```

## Agent Team

This architecture runs on a production OpenClaw deployment with **14 agents** working across multiple projects. Understanding the team helps explain why certain layers exist.

| Agent | Role | Why it matters for memory |
|-------|------|--------------------------|
| **Gandalf** | Main personal assistant | Owns MEMORY.md, USER.md. Only agent that loads personal context. |
| **Pete** | Project Manager (PM) | Maintains project memory files at phase close. Coordinates the team. |
| **Toby** | Lead Developer | Pulls tasks, writes code, runs QA. Resets frequently — needs institutional memory to survive. |
| **Beta-tester** | QA Agent | Tests against success criteria and scope. Reads project memory for context. |
| **Ram Dass** | Wisdom / integration coach | Separate persona with its own SOUL.md and principles. |

**The multi-agent problem:** Each agent has its own session. When Toby resets, he loses everything from the previous session. When Pete compacts, architecture decisions vanish. Project memory (Layer 2) exists specifically to solve this — one file per project, maintained centrally, read by all agents at boot.

**The multi-persona problem:** Each agent has its own SOUL.md with distinct personality and principles. The stability plugin tracks principle alignment per agent — Gandalf's "directness" principle is different from Ram Dass's "loving awareness."

## Layers

### Layer 1: Always-Loaded Context
Files injected into every session start. Keep them **lean** (total <2K tokens).

| File | Purpose | Target Size |
|------|---------|-------------|
| `active-context.md` | What's happening right now | <2KB |
| `USER.md` | Who your human is | <3KB |
| `SOUL.md` | Agent identity and voice | <2KB |
| `IDENTITY.md` | Quick identity card (name, emoji) | <0.5KB |

### Layer 2: Strategic Memory (MEMORY.md)
Long-term curated wisdom. **Main session only** — never loaded in shared contexts (Discord, group chats) to prevent personal context leakage.

| File | Purpose | Target Size |
|------|---------|-------------|
| `MEMORY.md` | Curated lessons, insights, key events | <8KB |

### Layer 3: Project Memory
Per-project institutional knowledge that survives agent resets and compaction.

```
memory/project-my-saas.md      — architecture decisions, lessons, conventions
memory/project-marketing-site.md — brand voice, content pipeline, legal rails
```

**The problem it solves:** When agents reset or compact, project knowledge vanishes. Your dev agent forgets the pull-based workflow. Your PM loses architecture decisions. New agents start from zero.

**The fix:** One file per project, agent-independent, maintained by the PM at phase close:

```
Wizard creates project → seeds project-{slug}.md
All project agents read at boot (step 1)
Agents work, learn, make decisions
PM consolidates at phase close → updates project-{slug}.md
Agent resets → boots with institutional knowledge intact
```

**What goes in:** Architecture decisions, hard-won lessons, workflow patterns, conventions, known risks.
**What stays out:** Backlog items, sprint status, daily logs — those are the DB's job.

Template: [`templates/project-memory.md`](templates/project-memory.md)

### Layer 4: Structured Facts (SQLite + FTS5)
For precise lookups that don't need embeddings.

```sql
-- "What's Partner's birthday?"
SELECT value FROM facts WHERE entity='Partner' AND key='birthday';
-- → "July 7, 1976" (instant, zero API calls)

-- Full-text search
SELECT * FROM facts_fts WHERE facts_fts MATCH 'birthday';
-- → All 6 family birthdays (instant, zero API calls)
```

Categories: `person`, `project`, `decision`, `convention`, `credential`, `preference`, `date`, `location`

### Layer 4.5: Knowledge Graph (SQLite)
For entity-relationship queries that keyword and vector search can't handle.

```sql
-- "What port does Keystone run on?"
SELECT object FROM relations WHERE subject='Project Keystone' AND predicate='runs_on';
-- → "port 3055" (instant, graph traversal)

-- "Who is Mama?" (alias resolution → facts + relations)
-- Resolves "Mama" → canonical entity → all facts + outgoing relations
```

Three tables extend `facts.db`: **relations** (subject-predicate-object triples), **aliases** (fuzzy entity names), and **relations_fts** (full-text search on triples).

**Benchmark results:** Hybrid search (graph + BM25) achieves **60/60 (100%)** recall on a 60-query benchmark, up from **28/60 (46.7%)** with BM25 alone. Graph-only achieves 96.7%. The knowledge graph now contains 1,265 facts, 488 relations, and 125 aliases across 361 entities — auto-ingested from 74 source files via `scripts/graph-ingest-daily.py`.

**Pipeline integration:** The `openclaw-plugin-graph-memory` hooks into OpenClaw's `before_agent_start` event, automatically injecting relevant entity matches as `[GRAPH MEMORY]` context before the LLM processes each message. Zero API cost, sub-2-second latency. See `plugin/` and `docs/knowledge-graph.md`.

**Context optimization:** Moving structured facts to the graph enabled aggressive trimming of workspace files — MEMORY.md (12.4KB → 3.5KB) and AGENTS.md (14.7KB → 4.3KB), saving ~6,500 tokens per session. See `docs/context-optimization.md`.

See [`docs/knowledge-graph.md`](docs/knowledge-graph.md) for full documentation, schema, search pipeline, and benchmark methodology.

### Layer 5: Semantic Search
For fuzzy recall where keywords don't match but meaning does. Works with:
- **QMD** (OpenClaw's built-in) — reranking + query expansion
- **Ollama** (local embeddings) — zero cost, 61ms
- **OpenAI** (cloud) — higher quality, per-call cost

### Layer 6: Daily Logs
`memory/YYYY-MM-DD.md` — raw session logs. What happened today. Source material for curation.

#### Importance Tagging

Every observation in a daily log gets an importance tag that controls retention:

```markdown
- [decision|i=0.9] Switched from PostgreSQL to SQLite for facts storage
- [milestone|i=0.85] Shipped v2.0 of memory architecture to GitHub
- [lesson|i=0.7] Partial array patches in config.patch nuke the entire list
- [task|i=0.6] Need to add rate limiting to the embedding endpoint
- [context|i=0.3] Ran routine memory maintenance, nothing notable
```

**Tag reference:**

| Tag | Importance | Meaning | Example |
|-----|-----------|---------|---------|
| `decision` | 0.9 | Choices made | Switched ORMs, picked a model |
| `milestone` | 0.85 | Things shipped/deployed/published | Released v2.0, deployed to prod |
| `lesson` | 0.7 | What you learned | "Don't partial-patch arrays" |
| `task` | 0.6 | Work identified but not done | "Need to add auth to endpoint" |
| `context` | 0.3 | Routine status, minor updates | "Ran backups, all green" |

**Retention tiers:**

| Tier | Importance | Retention | Rationale |
|------|-----------|-----------|-----------|
| **STRUCTURAL** | i ≥ 0.8 | Permanent | Decisions and milestones define the project's history |
| **POTENTIAL** | 0.4 ≤ i < 0.8 | 30 days | Lessons and tasks stay relevant for ~a month |
| **CONTEXTUAL** | i < 0.4 | 7 days | Routine status loses value fast |

#### Auto-Pruning

`scripts/prune-memory.py` enforces these retention tiers automatically:

```bash
# Preview what would be pruned
python3 scripts/prune-memory.py --dry-run

# Actually prune
python3 scripts/prune-memory.py
```

Run it on a cron, during heartbeats, or manually. It scans `memory/YYYY-MM-DD.md` files, removes expired observations, and reports structural items worth promoting to `MEMORY.md`.

### Layer 7: Procedural Memory (Runbooks)
`tools-*.md` files documenting HOW to do things — API endpoints, auth flows, multi-step procedures. Survives model switches and compaction.

### Layer 8: Gating Policies
Numbered failure prevention rules learned from actual mistakes:

```
GP-001 | Before config.patch on arrays | Read current, modify in full | Partial array patch nuked all agents
GP-004 | Before stating any date/time  | Run TZ command first         | Timezone mistakes from mental math
```

### Layer 9: Pre-Flight Checkpoints
State saves before risky operations. If compaction hits mid-task, checkpoints survive.

## Information Flow

### Upward (Consolidation)
```
Daily logs → active-context.md → MEMORY.md → facts.db
(raw)        (working memory)    (curated)   (structured)

Session work → phase close → project-{slug}.md
(ephemeral)   (PM gate)      (institutional)
```

### Session Boot Sequence

**Main agent (personal assistant):**
```
1. Read SOUL.md (who am I)
2. Read USER.md (who am I helping)
3. Read active-context.md (what's hot)
4. Read today's + yesterday's daily log
5. Read MEMORY.md
6. [On demand] Semantic search for specific recalls
7. [On demand] facts.db for structured lookups
8. [If risky task] Check gating-policies.md
```

**Project agents (dev, PM, QA, etc.):**
```
1. Read memory/project-{slug}.md (institutional knowledge — FIRST)
2. Read SOUL.md / IDENTITY.md (who am I)
3. Agent-specific boot steps (query project DB, check work queue, etc.)
4. Read today's daily log for recent context
```

### Session End (SLEEP)

Before a session ends, gets compacted, or when context is getting heavy:

```
1. Update memory/active-context.md — what the next session needs to know
2. Write observations to memory/YYYY-MM-DD.md with importance tags
3. If significant work happened → update MEMORY.md with distilled insights
```

This is the other half of the Wake/Sleep cycle. WAKE loads context; SLEEP preserves it. Without SLEEP, the next session boots blind.

## Setup

### 1. Create the directory structure

```bash
mkdir -p memory/checkpoints memory/runbooks
```

### 2. Initialize facts.db

```bash
python3 scripts/init-facts-db.py
```

Or manually:

```bash
python3 -c "
import sqlite3
db = sqlite3.connect('memory/facts.db')
db.executescript(open('schema/facts.sql').read())
db.close()
print('facts.db created')
"
```

### 3. Seed with your facts

Edit `scripts/seed-facts.py` with your personal facts, then run:

```bash
python3 scripts/seed-facts.py
```

### 4. Copy templates

```bash
cp templates/active-context.md memory/active-context.md
cp templates/gating-policies.md memory/gating-policies.md
```

### 5. Update your AGENTS.md

Add the boot sequence and memory sections from `templates/agents-memory-section.md` to your agent's workspace.

### 6. Configure semantic search (optional but recommended)

For local embeddings with Ollama:

```json
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "enabled": true,
        "provider": "openai",
        "remote": {
          "baseUrl": "http://localhost:11434/v1",
          "apiKey": "ollama"
        },
        "model": "nomic-embed-text",
        "fallback": "none"
      }
    }
  }
}
```

## Quick Reference

### Adding a fact
```python
python3 -c "
import sqlite3
db = sqlite3.connect('memory/facts.db')
db.execute('INSERT INTO facts (entity, key, value, category, source, permanent) VALUES (?, ?, ?, ?, ?, ?)',
    ('Alice', 'birthday', 'March 15, 1990', 'date', 'conversation', 1))
db.commit()
print('Added')
"
```

### Querying facts
```python
python3 -c "
import sqlite3
db = sqlite3.connect('memory/facts.db')
# Exact lookup
print(db.execute('SELECT value FROM facts WHERE entity=? AND key=?', ('Alice', 'birthday')).fetchone()[0])
# Full-text search
for row in db.execute('SELECT entity, key, value FROM facts_fts WHERE facts_fts MATCH ?', ('birthday',)):
    print(f'{row[0]}.{row[1]} = {row[2]}')
"
```

### Adding a gating policy
When something goes wrong, add a rule to `memory/gating-policies.md`:

```
| GP-XXX | [trigger condition] | [required action] | [what went wrong and when] |
```

## Plugin Layers (10–11)

Two OpenClaw plugins add runtime memory capabilities that operate **during** conversations, not just at boot time.

### Layer 10: Continuity Plugin (`openclaw-plugin-continuity`)

Cross-session memory and conversation awareness. Runs as an OpenClaw gateway plugin.

**What it does:**
- **Conversation archive** — Stores all exchanges in SQLite with SQLite-vec embeddings. Survives session resets.
- **Semantic search** — "What were we discussing about infrastructure last week?" searches across archived conversations, not just memory files.
- **GPU-accelerated embeddings** — Uses llama.cpp with `nomic-embed-text-v1.5` (768d) when available, falling back to ONNX `all-MiniLM-L6-v2` (384d). The llama.cpp backend is 60x faster for indexing and 20x faster for search.
- **Topic tracking** — Detects what topics are active, fixated (repeated too often), or fading. Injects `[CONTINUITY CONTEXT]` into prompts with session stats and active topics.
- **Continuity anchors** — Detects identity moments, contradictions, and tensions in conversation. Preserves them through compaction.
- **Context budgeting** — Priority-tiered token allocation. Recent turns get full text, older turns get compressed. Configurable pool ratios (essential/high/medium/low/minimal).

**Data location:** `~/.openclaw/extensions/openclaw-plugin-continuity/data/`
- `continuity.db` — SQLite + SQLite-vec archive (conversations + embeddings)
- `archive/` — JSON conversation archives by date

**Config:** Fully configurable via `openclaw.plugin.json` — token budgets, anchor detection keywords, topic fixation thresholds, compaction triggers, embedding model, archive retention days.

**⚠️ Known limitation — Recall truncation (v0.1.0):** When past exchanges are injected into a session via `prependContext`, the plugin truncates recalled text aggressively (150–300 chars by default). A 2,000-char agent response becomes a mangled 150-char snippet. Storage is intact — full text lives in SQLite — but the *recalled context* is too lossy for the agent to meaningfully use. We recommend patching `_truncate()` limits to 600–1000 chars and adding sentence-boundary-aware truncation. See [issue #2](https://github.com/CoderofTheWest/openclaw-plugin-continuity/issues/2).

### Layer 11: Stability Plugin (`openclaw-plugin-stability`)

Runtime behavioral monitoring. Keeps agents grounded and self-aware.

**What it does:**
- **Entropy monitoring** — Tracks conversation entropy (0.0 = stable, 1.0+ = drifting). Injects `[STABILITY CONTEXT]` with current entropy score and principle alignment.
- **Principle alignment** — Reads `## Core Principles` from each agent's SOUL.md. Tracks positive/negative pattern matches per principle. Reports alignment status (stable/drifting/critical).
- **Loop detection** — Catches tool loops (5+ consecutive exec calls) and file re-reads (3+ reads of the same file). Injects warnings to break the pattern.
- **Heartbeat decision framework** — Structured decision logging for heartbeat polls. Tracks what was checked, what was decided, prevents redundant work.
- **Confabulation detection** — Flags temporal mismatches, quality decay, and recursive meta-reasoning.

**Data location:** `~/.openclaw/extensions/openclaw-plugin-stability/data/`
- `entropy-monitor.jsonl` — Entropy history log
- `entropy-history.json` — Aggregated entropy stats
- `investigation-state.json` — Investigation rate limiting

**Config:** Entropy thresholds, principle sources, loop detection limits, governance rate limits, quiet hours, detector toggles — all in `openclaw.plugin.json`.

### How Plugins Interact with the Memory Stack

```
                    RUNTIME (during conversation)
                    ┌─────────────────────────┐
                    │  Continuity Plugin       │
                    │  • topic tracking        │──→ [CONTINUITY CONTEXT] injected
                    │  • conversation archive  │      into every prompt
                    │  • semantic recall       │
                    ├─────────────────────────┤
                    │  Stability Plugin        │
                    │  • entropy monitoring    │──→ [STABILITY CONTEXT] injected
                    │  • principle alignment   │      into every prompt
                    │  • loop guards           │
                    └─────────────────────────┘
                              │
                    BOOT TIME (session start)
                    ┌─────────────────────────┐
                    │  File-based layers       │
                    │  • active-context.md     │
                    │  • MEMORY.md             │
                    │  • USER.md / SOUL.md     │
                    │  • project-{slug}.md     │
                    │  • facts.db              │
                    └─────────────────────────┘
```

The plugins don't replace the file-based layers — they augment them. File layers handle **what you know** (facts, decisions, context). Plugins handle **how you're performing** (drift, repetition, topic awareness, cross-session recall).

### Plugin Installation

Both plugins are installed as OpenClaw gateway extensions:

```bash
# Clone into extensions directory
cd ~/.openclaw/extensions
git clone https://github.com/CoderofTheWest/openclaw-plugin-continuity.git
git clone https://github.com/CoderofTheWest/openclaw-plugin-stability.git

# Install dependencies
cd openclaw-plugin-continuity && npm install
cd ../openclaw-plugin-stability && npm install

# Enable in config (~/.openclaw/openclaw.json)
# Add to plugins.entries:
#   "continuity": { "enabled": true }
#   "stability": { "enabled": true }
#   "graph-memory": { "enabled": true }

# Restart gateway
openclaw gateway restart
```

### ⚠️ Critical: `plugins.allow` Allowlist

If you set `plugins.allow` in your OpenClaw config (recommended for security), **every plugin you want to load must be on the list** — including graph-memory:

```json
{
  "plugins": {
    "allow": ["continuity", "stability", "graph-memory", "telegram", "discord"],
    "entries": {
      "continuity": { "enabled": true },
      "stability": { "enabled": true },
      "graph-memory": { "enabled": true }
    }
  }
}
```

**Common gotcha:** Setting `"enabled": true` in entries is not enough. If `plugins.allow` exists and the plugin ID isn't listed, it silently won't load. No error, no warning — just missing `[GRAPH MEMORY]` context. You can verify by checking the `before_agent_start` handler count in gateway logs:

```
# 3 handlers = continuity + stability + graph-memory (correct)
[hooks] running before_agent_start (3 handlers, sequential)

# 2 handlers = graph-memory not loaded (check plugins.allow)
[hooks] running before_agent_start (2 handlers, sequential)
```

**Per-agent principles:** Add a `## Core Principles` section to each agent's SOUL.md for the stability plugin to track:

```markdown
## Core Principles
- **integrity** — investigate before asking, verify before claiming
- **directness** — no filler, no flattery, say what's true
- **reliability** — ship, don't talk about shipping
```

**Source:** [CoderofTheWest](https://github.com/CoderofTheWest) — community-built OpenClaw plugins.

## Search Telemetry

Both plugins log search performance to `/tmp/openclaw/memory-telemetry.jsonl`. Each entry records which system handled the query, how long it took, result quality, and whether it was injected into context.

```bash
# Aggregate report — latency percentiles, hit rates, system contribution
node scripts/memory-telemetry.js report

# Golden query benchmark — 10 known-good queries, tests both systems
node scripts/memory-telemetry.js benchmark

# Live watch — see searches in real-time
node scripts/memory-telemetry.js tail
```

**Sample report output:**
```
=== Memory Search Telemetry (42 queries) ===

System               | Queries |  Hits |  Miss | Inject |  p50ms |  p95ms | AvgDist
-------------------------------------------------------------------------------------
continuity           |      30 |    30 |     0 |     28 |     12 |     25 |   0.371
graph-memory         |      12 |     8 |     4 |      8 |     35 |     50 |     n/a

--- System Contribution ---
  continuity         | 78% of injections | 100% hit rate | 30 hits, 0 misses
  graph-memory       | 22% of injections | 67% hit rate  | 8 hits, 4 misses
```

**Telemetry fields:**
| Field | Description |
|-------|-------------|
| `system` | `continuity`, `graph-memory`, or `qmd-bm25` |
| `latencyMs` | End-to-end search time |
| `resultCount` | Results returned |
| `topDistance` | Cosine distance of best match (continuity only, lower = better) |
| `injected` | Whether results were injected into the LLM context |
| `entityMatched` | Entity-matched results (graph-memory only) |
| `reason` | Why results were dropped: `too-short`, `no-entity-match`, `error` |

## Embedding Options

| Provider | Cost | Latency | Dims | Quality | Setup |
|----------|------|---------|------|---------|-------|
| **llama.cpp + nomic-embed-text-v1.5** | Free | **4ms** (GPU batch) | 768 | Best | Docker + GGUF model |
| **Ollama nomic-embed-text** | Free | 61ms | 768 | Good | `ollama pull nomic-embed-text` |
| **ONNX MiniLM-L6-v2** | Free | 240ms | 384 | Fair | Built into continuity plugin |
| **QMD (built-in)** | Free | ~4s | — | Best (reranked) | Included with OpenClaw |
| **OpenAI text-embedding-3-small** | ~$0.02/M tokens | ~200ms | 1536 | Great | API key required |

**Recommendation:** If you have a GPU, use **llama.cpp** — it's 60x faster than ONNX and produces higher-quality 768d embeddings. The continuity plugin auto-detects it on `http://localhost:8082` (configurable via `LLAMA_EMBED_URL` env var) and falls back to ONNX if unavailable.

### llama.cpp Embedding Server Setup

```yaml
# docker-compose.yml for dedicated embedding server
services:
  llama-embed:
    image: ghcr.io/ggml-org/llama.cpp:server  # or ROCm variant
    container_name: llama-embed
    restart: unless-stopped
    ports:
      - "8082:8080"
    volumes:
      - ./models:/models:ro
    command: >
      llama-server
        -m /models/nomic-embed-text-v1.5-f16.gguf
        --embedding
        --pooling mean
        -c 2048
        -ngl 999
        --host 0.0.0.0
        --port 8080
```

Download the model: `huggingface-cli download nomic-ai/nomic-embed-text-v1.5-GGUF nomic-embed-text-v1.5.f16.gguf`

**Important:** nomic-embed-text uses task prefixes. The continuity plugin handles this automatically:
- Indexing: `search_document: <text>`
- Querying: `search_query: <text>`

### GPU Setup (AMD ROCm)

If you have an AMD GPU, use the `ollama/ollama:rocm` Docker image with device passthrough. See [`docs/embedding-setup.md`](docs/embedding-setup.md) for the full docker-compose with ROCm flags, group IDs, and environment variables.

**Pro tip:** Pin the embedding model permanently in VRAM for instant responses:
```bash
curl -s http://localhost:11434/api/generate \
  -d '{"model":"nomic-embed-text","keep_alive":-1}'
```

## Reference Hardware

This architecture is battle-tested on:

| Component | Spec |
|-----------|------|
| **CPU** | AMD Ryzen AI MAX+ 395 — 16c/32t |
| **RAM** | 32GB DDR5 (unified with GPU) |
| **GPU** | AMD Radeon 8060S — 40 CUs, 96GB unified VRAM |
| **Storage** | 1.9TB NVMe |
| **OS** | Ubuntu 25.10 |

The 96GB unified VRAM lets us run embedding models, rerankers, and large LLMs simultaneously without swapping. Smaller setups (8-16GB VRAM) work fine — just use Ollama alone without QMD, and don't pin too many models.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for detailed VRAM allocation breakdown and full hardware documentation.

## Semantic Code Search (Optional)

For codebase-aware agents, add [grepai](https://github.com/yoanbernabeu/grepai) — semantic code search using the same `nomic-embed-text` model. Search your code by meaning ("authentication logic") instead of text patterns.

```bash
grepai init && grepai watch &
grepai search "error handling patterns"
grepai trace callers "getAgents"
```

See [docs/code-search.md](docs/code-search.md) for full setup.

## Credits

This architecture was informed by:
- **David Badre** — *On Task: How the Brain Gets Things Done* (cognitive gating theory)
- **Shawn Harris** — [Building a Cognitive Architecture for Your OpenClaw Agent](https://shawnharris.com/building-a-cognitive-architecture-for-your-openclaw-agent/) (active-context.md, gating policies, runbooks)
- **r/openclaw community** — Hybrid SQLite+FTS5+vector memory approach (structured facts, memory decay, decision extraction)
- **CoderofTheWest** — [openclaw-plugin-continuity](https://github.com/CoderofTheWest/openclaw-plugin-continuity) and [openclaw-plugin-stability](https://github.com/CoderofTheWest/openclaw-plugin-stability) — runtime conversation archive, topic tracking, entropy monitoring, and principle alignment. Also discovered the [proprioceptive framing pattern](https://www.reddit.com/r/openclaw/comments/1r6rnq2/memory_fix_you_all_want/): identity docs must explicitly claim ownership of every memory system, or the agent won't use them
- **Claw (r/openclaw)** — [Memory benchmark methodology](https://old.reddit.com/r/openclaw/comments/1r7nd4y/) proving content structure > embedding quality, and validating QMD over builtin search (82% vs 50%)
- Battle-tested on a production OpenClaw deployment managing 14 agents across multiple projects.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

MIT — use it, adapt it, share what you learn.
