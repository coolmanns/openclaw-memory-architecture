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

## Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│           LOSSLESS CONTEXT ENGINE (lcm.db)            │
│  Stores all messages → builds summary DAG → assembles │
│  context window from DAG + live messages              │
├──────────────────────────────────────────────────────┤
│                                                       │
│  CONTEXT WINDOW (~200K tokens, assembled by LCM)      │
│                                                       │
│  ┌────────────────────────────────────────────────┐   │
│  │  Workspace Files (always loaded)               │   │
│  │  MEMORY.md · USER.md · SOUL.md · AGENTS.md     │   │
│  └────────────────────────────────────────────────┘   │
│                                                       │
│  ┌────────────────────────────────────────────────┐   │
│  │  Plugin Context (injected at runtime)          │   │
│  │  Continuity · Stability · Metabolism            │   │
│  └────────────────────────────────────────────────┘   │
│                                                       │
│  ┌────────────────────────────────────────────────┐   │
│  │  Conversation (managed by LCM)                 │   │
│  │  Live messages + DAG summaries of older ones    │   │
│  └────────────────────────────────────────────────┘   │
│                                                       │
├──────────────────────────────────────────────────────┤
│              PERSISTENT STORAGE                       │
├──────────────────────────────────────────────────────┤
│                                                       │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│  │   lcm.db     │ │  facts.db    │ │ continuity   │ │
│  │  Messages    │ │  Entities    │ │  Archives    │ │
│  │  Summaries   │ │  Relations   │ │  Embeddings  │ │
│  │  FTS index   │ │  Aliases     │ │  Topics      │ │
│  │  DAG nodes   │ │  Decay tiers │ │  Anchors     │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ │
│                                                       │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│  │  LightRAG    │ │  Embeddings  │ │  Daily Files  │ │
│  │  PostgreSQL  │ │  llama.cpp   │ │  memory/*.md  │ │
│  │  GraphRAG    │ │  nomic 768d  │ │  Journal      │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ │
│                                                       │
├──────────────────────────────────────────────────────┤
│       METACOGNITIVE PIPELINE (main agent only)        │
│  Metabolism → Gaps → Contemplation → Growth Vectors   │
└──────────────────────────────────────────────────────┘
```

## Layers Quick Reference

| Layer | System | Searchable via | Purpose | Latency |
|-------|--------|---------------|---------|---------|
| **0** | **LCM (lossless-claw)** | **`memory_search` (lcm) + LCM tools** | **Lossless within-session context — DAG + FTS** | **Runtime** |
| 1 | Always-loaded files | (injected) | Identity, working memory | 0ms |
| 2 | MEMORY.md | (injected) | Curated long-term wisdom | 0ms |
| 3 | PROJECT.md per project | (injected) | Institutional knowledge | 0ms |
| 4 | facts.db | `memory_search` (facts) | Structured entity/key/value | <1ms |
| 5 | Continuity archive | `memory_search` (continuity) | Cross-session conversation recall | 7ms |
| 5a | File-vec index | `memory_search` (files) | Workspace document search | 7ms |
| 5b | LightRAG | Dedicated tool | Domain GraphRAG (11 books + 139 papers) | ~200ms |
| 6 | Daily logs | On demand | Raw session history | On demand |
| 10 | Continuity plugin | — | Context budgeting, topic tracking, anchors | Runtime |
| 11 | Stability plugin | — | Entropy monitoring, growth vectors | Runtime |
| 12 | Metabolism plugin | — | Fact extraction, gap detection | Runtime |
| 13 | Contemplation plugin | — | Deep inquiry pipeline (3-pass) | Background |

## Unified Search: `memory_search`

One tool, four backends, one call:

```
memory_search("what did we decide about the database?")
        │
        ├── continuity  — semantic vector search over conversation archives (384d embeddings)
        ├── facts       — structured entity/key/value lookup + FTS5 (facts.db)
        ├── files       — workspace document vector search (file-vec index)
        └── lcm         — full-text search over lossless messages + summaries (lcm.db FTS5)
        │
        ▼
    Combined results — one response, all memory systems
```

All four backends run **in parallel** — no latency penalty from adding more. Results are formatted by type:

| Backend | What it finds | Best for |
|---------|--------------|----------|
| **continuity** | Past conversations (semantic similarity + temporal re-ranking) | "What did we discuss about X?" |
| **facts** | Structured facts, preferences, decisions (exact + fuzzy) | "What's my daughter's birthday?" |
| **files** | Workspace documents, project files, notes | "Where did I document the deploy process?" |
| **lcm** | Raw messages + compressed summaries from lossless history | "What command did I run yesterday?" |

### When to go deeper

`memory_search` covers 90% of recall needs. For the other 10% — when you need to drill into a compressed summary, trace a decision chain, or recover exact commands from a long session — use the dedicated LCM tools:

- `lcm_grep` — targeted regex/full-text search (same as the lcm backend, but standalone)
- `lcm_describe` — inspect a specific summary's metadata
- `lcm_expand_query` — spawn a sub-agent to traverse the DAG and answer questions from expanded context (~120s, for precision questions)

### Configuration

```bash
# Search all backends (default)
memory_search(query: "database migration", systems: "continuity,facts,files,lcm")

# Search specific backends
memory_search(query: "Sascha's birthday", systems: "facts")
memory_search(query: "deployment steps", systems: "files,lcm")
```

The `systems` parameter defaults to `continuity,facts,files,lcm`. Pass a comma-separated subset to narrow scope.

## Key Features

### Multilingual Embeddings
- **Model:** nomic-embed-text-v2-moe (768d)
- **Languages:** 100+ including German
- **Latency:** ~7ms on GPU
- **Setup:** llama.cpp Docker container with ROCm

### Knowledge Graph
- **Scale:** 770+ facts, relations, aliases (post-cleanup)
- **Decay system:** Hot/Warm/Cool tiers, `superseded_at` invalidation
- **Facts writer:** Metabolism plugin (Anthropic Sonnet, every 5 min)

### Domain RAG (LightRAG)
- **Content:** 5-MeO-DMT research, books, guides, 139 research papers
- **Scale:** 4,909 entities, 6,089 relations (GraphRAG)
- **Stack:** PostgreSQL + pgvector, OpenAI gpt-4.1-mini for extraction

### Runtime Plugins (main agent only)
- **Continuity:** Cross-session memory, topic tracking, facts search
- **Stability:** Entropy monitoring, principle alignment, growth vectors
- **Metabolism:** LLM-based fact extraction, knowledge gap detection
- **Contemplation:** Three-pass deep inquiry (explore → reflect → synthesize)

## Embedding Options

| Provider | Cost | Latency | Dims | Quality | Notes |
|----------|------|---------|------|---------|-------|
| **llama.cpp (GPU)** ✅ | Free | **4ms** | 768 | Best | Multilingual, local |
| **Ollama nomic-embed-text** | Free | 61ms | 768 | Good | `ollama pull nomic-embed-text` |
| **OpenAI** | ~$0.02/M | ~200ms | 1536 | Great | Cloud API, no local GPU needed |

**Our setup:** llama.cpp with nomic-embed-text-v2-moe at `localhost:8082`. All embedding consumers (continuity, semantic search, grepai) hit this single server. Zero API cost, 768d, multilingual.

## Quick Start

### 1. Directory Structure

Create a `memory/` directory in your OpenClaw workspace (the directory configured as your agent's working directory in `openclaw.json`). This is where daily journal files (`YYYY-MM-DD.md`), `active-context.md`, and heartbeat state live.

```bash
# Inside your OpenClaw workspace root (e.g. ~/clawd)
mkdir -p memory
```

### 2. Initialize facts.db

```bash
python3 scripts/init-facts-db.py
```

### 3. Seed Facts

```bash
python3 scripts/seed-facts.py
```

### 4. Configure Embeddings

For llama.cpp GPU (recommended):

```yaml
# docker-compose.yml for dedicated embedding server
services:
  llama-embed:
    image: ghcr.io/ggml-org/llama.cpp:server
    container_name: llama-embed
    restart: unless-stopped
    ports:
      - "8082:8080"
    volumes:
      - ./models:/models:ro
    command: >
      llama-server
        -m /models/nomic-embed-text-v2-moe.Q6_K.gguf
        --embedding
        --pooling mean
        -c 2048
        -ngl 999
        --host 0.0.0.0
        --port 8080
```

### 5. Install Plugins

```bash
cd ~/.openclaw/extensions

# Core memory plugins (our forks)
git clone https://github.com/coolmanns/openclaw-plugin-continuity.git
git clone https://github.com/coolmanns/openclaw-plugin-metabolism.git

# Upstream plugins
git clone https://github.com/CoderofTheWest/openclaw-plugin-stability.git

# Lossless context engine (replaces default compaction)
git clone https://github.com/Martian-Engineering/lossless-claw.git

# Optional: metacognitive stack
git clone https://github.com/CoderofTheWest/openclaw-metacognitive-suite.git
cp -r openclaw-metacognitive-suite/openclaw-plugin-contemplation .

# Install dependencies
for d in openclaw-plugin-* lossless-claw; do cd "$d" && npm install && cd ..; done
```

### 6. Configure in `~/.openclaw/openclaw.json`

```json
{
  "plugins": {
    "allow": [
      "openclaw-plugin-continuity",
      "openclaw-plugin-stability",
      "openclaw-plugin-metabolism",
      "openclaw-plugin-contemplation",
      "lossless-claw"
    ],
    "entries": {
      "openclaw-plugin-continuity": { "enabled": true },
      "openclaw-plugin-stability": { "enabled": true },
      "openclaw-plugin-metabolism": { "enabled": true },
      "lossless-claw": { "enabled": true }
    },
    "slots": {
      "contextEngine": "lossless-claw"
    }
  }
}
```

> **Note:** The `slots.contextEngine` assignment is what activates LCM. Without it, lossless-claw loads as a regular plugin but never takes over context management.

### 7. Schedule Decay Cron (optional)

facts.db uses a Hebbian-inspired activation model: facts that get accessed frequently stay "hot," while unused facts gradually cool down. The decay cron runs nightly to age activation scores across all facts.

```bash
# Runs at 3 AM daily — adjusts activation tiers (Hot → Warm → Cool)
# Logs to persistent location (survives reboots)
(crontab -l 2>/dev/null; echo "0 3 * * * python3 ~/clawd/scripts/graph-decay.py >> ~/clawd/logs/graph-decay.log 2>&1") | crontab -
```

> **Note:** The decay scoring columns (`decay_score`, `activation`, `importance`) exist in the schema but the ranking logic is still a stub — facts are stored and searched but decay doesn't yet influence search result ordering. This is on the [roadmap](#roadmap) (Task #93). The cron is safe to run now; it just won't affect behavior until the ranking integration is wired up.

## Reference Hardware

| Component | Spec |
|-----------|------|
| CPU | AMD Ryzen AI MAX+ 395 — 16c/32t |
| RAM | 32GB DDR5 (unified with GPU) |
| GPU | AMD Radeon 8060S — 96GB unified VRAM |
| Storage | 1.9TB NVMe |

The 96GB unified VRAM enables running large models without swapping. Smaller setups (8-16GB) work fine with llama.cpp alone.

## Metacognitive Pipeline (v2.4)

Beyond storage and recall, the architecture includes a metacognitive loop that lets the agent learn from its own conversations:

```
Conversation → Metabolism (extract facts + gaps)
                    ↓                    ↓
              facts.db            pending-gaps.json
              (superseded_at        ↓
               invalidation)   Nightshift cron (23:00-08:00)
                                     ↓
                              Contemplation (3-pass over 24h)
                                     ↓
                              Growth Vectors (19 active)
                                     ↓
                              Crystallization (30+ day gate)
```

- **Metabolism** — Anthropic Sonnet extracts facts, implications, and knowledge gaps. Metadata pre-filter strips 10+ noise patterns. Entity normalization via gazetteer. Writes to facts.db (with `superseded_at` invalidation) and forwards gaps via file queue.
- **Contemplation** — Three-pass inquiry pipeline (explore → reflect → synthesize) triggered by nightshift cron. Each gap examined over ~24 hours.
- **Growth Vectors** — 19 active vectors (deduped from 902 candidates via Jaccard similarity). Unified schema with `area`/`direction`/`priority` fields.
- **Crystallization** — Promotes growth vectors to permanent character traits after 30+ days. Three-gate model: time + principle alignment + human approval. (Not yet installed — next after contemplation proven.)

**Per-agent scoping:** The entire metacognitive pipeline runs for the **main agent only**. Other agents (cron-agent, spiritual-dude) are silently skipped to prevent orphaned data.

## Lossless Context Management (LCM)

The newest layer — and architecturally the most significant. Instead of OpenClaw's default "chop and forget" compaction, LCM preserves every message in an immutable SQLite store and builds a summary DAG during compaction.

**How it works:**
1. Every message (user, assistant, tool I/O) is stored in `lcm.db` with FTS5 indexing
2. When the context window fills, LCM creates leaf summaries (depth 0) from the oldest messages
3. As more summaries accumulate, they're merged into higher-level summaries (depth 1, 2, ...)
4. Context assembly walks the DAG to reconstruct the most relevant context per turn
5. Nothing is ever deleted — you can drill into any summary to recover the original messages

**Search tools:**
- `memory_search` (lcm backend) — FTS5 search over messages and summaries, runs in parallel with other backends
- `lcm_grep` — standalone regex or full-text search (same underlying query, more control)
- `lcm_describe` — inspect a specific summary's metadata and content
- `lcm_expand` — traverse the DAG to recover compressed detail
- `lcm_expand_query` — delegated sub-agent answers questions from expanded context

**Complementary to continuity:** LCM handles within-session lossless context. Continuity handles cross-session archive and recall. They serve different timescales. Both are searchable through the same `memory_search` tool — continuity via semantic vectors, LCM via full-text search.

**Config:**
```json
{
  "plugins": {
    "slots": {
      "contextEngine": "lossless-claw"
    }
  }
}
```

## Roadmap

### Near-term (next 2-4 weeks)
1. **LCM secrets scrubbing** — Tool I/O is stored verbatim in lcm.db. API keys, tokens, and sensitive data in exec/read output land in the DB permanently. Need a scrubbing layer before storage.
2. **Crystallization plugin (Task #92)** — Install and configure the growth vector → permanent trait pipeline. Blocked on contemplation proving itself (first successful passes needed).
3. **Hebbian decay implementation (Task #93)** — `decay_score`, `activation`, `importance` columns exist in facts.db but the actual decay logic is a stub. Wire real decay into search ranking.

> ✅ **Done:** `prependContext → prependSystemContext` migration — Continuity and stability plugins now inject via `prependSystemContext` (system prompt space, not ingested by LCM DAG).

### Mid-term (1-3 months)
5. **Growth vector quality (Task #102)** — Current extraction prompt produces operational noise as "insights." Need behavioral vs. operational separation. Metabolism pipeline v2 redesign.
6. **Metabolism on lcm.db** — Instead of extracting facts from compacted conversation snippets, metabolism could run session-end extraction against the full lossless record in lcm.db. Better input = better output.
7. **Cross-session LCM queries** — `lcm_grep` and `lcm_expand_query` with `allConversations: true` to search across every session the agent has ever had. The "perfect memory" use case.

### Vision
8. **Unified knowledge architecture** — The LCM DAG as both conversation record AND knowledge graph. Growth vectors as DAG annotations. Facts as DAG-derived entities. One store, multiple views. The summary DAG already captures relationships between topics naturally — extracting them explicitly would close the loop between "what was discussed" and "what was learned."

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Full layer documentation
- [`docs/knowledge-graph.md`](docs/knowledge-graph.md) — Graph search, benchmarks
- [`docs/context-optimization.md`](docs/context-optimization.md) — Token trimming methodology
- [`docs/adr/`](docs/adr/) — Architecture Decision Records
- [`CHANGELOG.md`](CHANGELOG.md) — Version history

## Credits

This architecture was informed by:
- **David Badre** — *On Task: How the Brain Gets Things Done*
- **Shawn Harris** — [Building a Cognitive Architecture for Your OpenClaw Agent](https://shawnharris.com/building-a-cognitive-architecture-for-your-openclaw-agent/) — Memory gating, active-context patterns, gating policies
- **r/openclaw community** — [How I Built a Memory System That Actually Works](https://old.reddit.com/r/openclaw/comments/1r7nd4y/how_i_built_a_memory_system_that_actually_works/) — Hybrid search benchmarking
- **CoderofTheWest** — Original continuity, stability, metabolism, contemplation, and crystallization plugins (upstream)
- **Martian Engineering** — [lossless-claw](https://github.com/Martian-Engineering/lossless-claw) context engine plugin
- Our forks:
  - [coolmanns/openclaw-plugin-continuity](https://github.com/coolmanns/openclaw-plugin-continuity) — Hebbian facts search, prependSystemContext migration, entity resolution
  - [coolmanns/openclaw-plugin-metabolism](https://github.com/coolmanns/openclaw-plugin-metabolism) — Custom guardrails, metadata pre-filter, entity normalization
  - [coolmanns/openclaw-plugin-stability](https://github.com/coolmanns/openclaw-plugin-stability) — prependSystemContext migration, growth vector schema

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

MIT — use it, adapt it, share what you learn.