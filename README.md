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
│              LOSSLESS CONTEXT MANAGEMENT               │
│       Immutable SQLite DAG — nothing is forgotten      │
│    lcm.db: messages + summaries + FTS + context items  │
├──────────────────────────────────────────────────────┤
│                  SESSION CONTEXT                      │
│            (~200K token window)                        │
├──────────────────────────────────────────────────────┤
│                                                       │
│  ┌────────────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ active-context │  │ MEMORY   │  │   USER.md    │ │
│  │ .md            │  │ .md      │  │              │ │
│  │ Working memory │  │ Curated  │  │  Who your    │ │
│  │ What's hot NOW │  │ wisdom   │  │  human is    │ │
│  └───────┬────────┘  └────┬─────┘  └──────────────┘ │
│          │                │                           │
│  ┌───────┴────────────────┴────────────────────────┐ │
│  │        KNOWLEDGE GRAPH (SQLite + FTS5)           │ │
│  │   facts.db + relations + aliases                 │ │
│  │   Activation scoring + decay (Hot/Warm/Cool)     │ │
│  └───────┬────────────────┬────────────────────────┘ │
│          │                │                           │
│  ┌───────┴────────────────┴────────────────────────┐ │
│  │            SEMANTIC SEARCH                       │ │
│  │   llama.cpp GPU (nomic-embed-text, 768d)        │ │
│  │   Multilingual: 100+ languages                   │ │
│  └────────────────────────────────────────────────┘ │
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │       DOMAIN RAG (LightRAG + PostgreSQL)          │ │
│  │   GraphRAG — 4,909 entities, 6,089 relations      │ │
│  │   11 books + 139 research papers                  │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
├──────────────────────────────────────────────────────┤
│              PLUGIN LAYERS (Runtime)                  │
├──────────────────────────────────────────────────────┤
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │         CONTINUITY PLUGIN                         │ │
│  │  Cross-session archive (sqlite-vec, 768d)         │ │
│  │  Topic tracking, continuity anchors, facts search │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │         STABILITY PLUGIN                          │ │
│  │  Entropy monitoring, principle alignment          │ │
│  │  Loop detection, growth vectors                   │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │    METACOGNITIVE PIPELINE (main agent only)       │ │
│  │  Metabolism → Contemplation → Crystallization     │ │
│  │  Facts + gaps + growth vectors + character traits  │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
└──────────────────────────────────────────────────────┘
```

## Layers Quick Reference

| Layer | System | Purpose | Latency |
|-------|--------|---------|---------|
| **0** | **LCM (lossless-claw)** | **Lossless within-session context — DAG + FTS** | **Runtime** |
| 1 | Always-loaded files | Identity, working memory | 0ms (injected) |
| 2 | MEMORY.md | Curated long-term wisdom | 0ms (injected) |
| 3 | PROJECT.md per project | Institutional knowledge | 0ms (injected) |
| 4 | facts.db | Structured entity/key/value | <1ms (SQLite) |
| 5 | Semantic search | Fuzzy recall, document search | 7ms (GPU) |
| 5a | LightRAG | Domain GraphRAG (11 books + 139 papers) | ~200ms |
| 6 | Daily logs | Raw session history | On demand |
| 10 | Continuity plugin | Cross-session conversation archive | Runtime |
| 11 | Stability plugin | Entropy monitoring, growth vectors | Runtime |
| 12 | Metabolism plugin | Fact extraction, gap detection | Runtime |
| 13 | Contemplation plugin | Deep inquiry pipeline (3-pass) | Background |

## Key Features

### Multilingual Embeddings
- **Model:** nomic-embed-text-v2-moe (768d)
- **Languages:** 100+ including German
- **Latency:** ~7ms on GPU
- **Setup:** llama.cpp Docker container with ROCm

### Lossless Context Management (LCM)
- **Plugin:** [lossless-claw](https://github.com/Martian-Engineering/lossless-claw) v0.2.3
- **Store:** Immutable SQLite — every message, tool call, and response preserved forever
- **DAG:** Summaries build a directed acyclic graph during compaction — detail is compressed but never lost
- **Search:** `lcm_grep` (regex + FTS), `lcm_expand_query` (sub-agent deep recall)
- **Complementary to continuity:** LCM = within-session lossless record, continuity = cross-session archive

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
| **llama.cpp (GPU)** | Free | **4ms** | 768 | Best | Multilingual, local |
| **Ollama nomic-embed-text** | Free | 61ms | 768 | Good | `ollama pull nomic-embed-text` |
| **ONNX MiniLM-L6-v2** | Free | 240ms | 384 | Fair | Built into continuity plugin |
| **OpenAI** | ~$0.02/M | ~200ms | 1536 | Great | Cloud API |

**Recommendation:** llama.cpp for speed, multilingual support, and zero API cost.

## Quick Start

### 1. Directory Structure

```bash
mkdir -p memory/checkpoints memory/runbooks
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

### 5. Enable Plugins

```bash
cd ~/.openclaw/extensions
git clone https://github.com/coolmanns/openclaw-plugin-continuity.git
git clone https://github.com/coolmanns/openclaw-plugin-metabolism.git
git clone https://github.com/CoderofTheWest/openclaw-plugin-stability.git

# Optional: metacognitive stack (contemplation + crystallization)
git clone https://github.com/CoderofTheWest/openclaw-metacognitive-suite.git
cp -r openclaw-metacognitive-suite/openclaw-plugin-contemplation .

# Install dependencies
for d in openclaw-plugin-*; do cd "$d" && npm install && cd ..; done
```

Enable in `~/.openclaw/openclaw.json`:

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

### 6. Schedule Decay Cron

```bash
(crontab -l 2>/dev/null; echo "0 3 * * * python3 ~/clawd/scripts/graph-decay.py >> /tmp/openclaw/graph-decay.log 2>&1") | crontab -
```

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
- `lcm_grep` — regex or full-text search across all messages and summaries
- `lcm_describe` — inspect a specific summary's metadata and content
- `lcm_expand` — traverse the DAG to recover compressed detail
- `lcm_expand_query` — delegated sub-agent answers questions from expanded context

**Complementary to continuity:** LCM handles within-session lossless context. Continuity handles cross-session archive and recall. They serve different timescales.

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
2. **prependContext → prependSystemContext migration** — Continuity and stability plugins inject context via `prependContext`, which pollutes the LCM DAG with plugin metadata. Must migrate to `prependSystemContext` (system prompt injection that bypasses the DAG).
3. **Crystallization plugin (Task #92)** — Install and configure the growth vector → permanent trait pipeline. Blocked on contemplation proving itself (first successful passes needed).
4. **Hebbian decay implementation (Task #93)** — `decay_score`, `activation`, `importance` columns exist in facts.db but the actual decay logic is a stub. Wire real decay into search ranking.

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
- Continuity and metabolism forks: [coolmanns/openclaw-plugin-continuity](https://github.com/coolmanns/openclaw-plugin-continuity), [coolmanns/openclaw-plugin-metabolism](https://github.com/coolmanns/openclaw-plugin-metabolism)

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

MIT — use it, adapt it, share what you learn.