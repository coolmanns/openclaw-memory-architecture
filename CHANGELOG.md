# Changelog

## v5.0 — Pipeline Integration + Auto-Ingestion (2026-02-18)

### New: OpenClaw Plugin (`plugin/`)
- `openclaw-plugin-graph-memory` — hooks `before_agent_start`, injects entity matches as `[GRAPH MEMORY]` prependContext
- Smart filtering: only injects when entities are matched (score ≥ 65), skips FTS-only noise
- 2s timeout, zero external dependencies (spawns Python subprocess)
- Install: copy to `~/.openclaw/extensions/`, enable via `openclaw plugins enable graph-memory`

### New: Auto-Ingestion Script (`scripts/graph-ingest-daily.py`)
- Bulk extraction from daily journal files and memory files
- Parses tagged entries (`[milestone|i=0.85]`), structured data (key-value bullets), section content
- Auto-categorizes facts (event, project, infrastructure, identity, etc.)
- Supports `--dry-run`, `--file`, `--stats`, `--all` modes
- Graph grew from 139 → 1,265 facts, 82 → 488 relations through ingestion

### Improved: Graph Search (`scripts/graph-search.py`)
- Word boundary fix for alias matching — prevents "flo" matching inside "overflow"
- Properly filters short aliases using `\b` regex

### New: Context Optimization Guide (`docs/context-optimization.md`)
- Methodology for trimming workspace files loaded every session
- MEMORY.md: 12.4KB → 3.5KB (-72%), AGENTS.md: 14.7KB → 4.3KB (-70%)
- ~6,500 tokens/session saved

### Updated: Knowledge Graph Docs (`docs/knowledge-graph.md`)
- Updated scale numbers (1,265 facts, 488 relations, 125 aliases, 361 entities)
- Added plugin integration section
- Added auto-ingestion section
- Added context optimization section

### Benchmark
- Hybrid: 100% (60/60) after recalibration
- Graph-only: 96.7% (58/60)
- Fixed source attribution mismatches from backfilled entries
- Added missing aliases and entities for edge cases

---

## v4.0 — Knowledge Graph Layer (2026-02-17)

### New: Knowledge Graph (`scripts/graph-init.py`, `scripts/graph-search.py`)
- SQLite-based entity/relationship store with FTS5 full-text search
- Four-phase search pipeline: entity+intent → entity facts → FTS facts → FTS relations
- Alias resolution for nicknames, abbreviations, and alternate names

### New: 60-Query Benchmark (`scripts/memory-benchmark.py`)
- 7 categories: PEOPLE, TOOLS, PROJECTS, FACTS, OPERATIONAL, IDENTITY, DAILY
- Methods: QMD (BM25), graph, hybrid
- Progression: 46.7% BM25-only → 100% hybrid

### New: Graph Viewer (`templates/graph-viewer.html`)
- Interactive D3.js force-directed visualization
- Color-coded by category, searchable, zoomable

---

## v3.0 — Hybrid Search (2026-02-15)

- QMD BM25 + vector search integration
- Local Ollama embeddings (nomic-embed-text, 768d)
- Memory file indexing across workspace

## v2.0 — Continuity Plugin (2026-02-14)

- Conversation archive with semantic search (SQLite-vec)
- Context budgeting and priority tiers
- Topic tracking and continuity anchors

## v1.0 — Initial Architecture (2026-02-10)

- MEMORY.md + daily files pattern
- Active-context.md working memory
- Gating policies for failure prevention

## 2026-02-20 — llama.cpp Embedding Backend + Telemetry

### plugin-continuity (forked from CoderofTheWest/openclaw-plugin-continuity)
- **BREAKING**: Replaced ONNX embedding (MiniLM-L6-v2, 384d) with llama.cpp GPU backend (nomic-embed-text-v1.5, 768d)
- ONNX retained as fallback if llama.cpp server is unavailable
- Fixed init order: embeddings initialize before table creation (prevents dimension mismatch)
- Auto-detects dimension changes and recreates vector table
- Added search telemetry logging to `/tmp/openclaw/memory-telemetry.jsonl`
- Default dimensions changed from 384 → 768
- Performance: 6.5ms avg search (was ~240ms), 12s full re-index (was ~6.5min)
- Configurable via `LLAMA_EMBED_URL` env var (default: `http://localhost:8082`)

### plugin-graph-memory
- Added search telemetry logging (latency, result count, entity matches, FTS hits)
- Added timing instrumentation on graph search

### scripts/memory-telemetry.js (NEW)
- `report` — aggregate stats by system (p50/p95 latency, hit rates, injection rates)
- `benchmark` — 10 golden queries across both systems (currently scoring 100%)
- `tail` — live telemetry watch

### Infrastructure
- New Docker container: `llama-embed` (llama.cpp + nomic-embed-text-v1.5-f16.gguf on ROCm GPU)
- Managed via Komodo stack on port 8082
