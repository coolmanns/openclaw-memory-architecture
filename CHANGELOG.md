# Changelog

## v2.2 — Single-DB Consolidation + Category Taxonomy (2026-03-05)

### Breaking: Single facts.db
- **Consolidated dual-DB to single DB** at `~/.openclaw/data/facts.db`
- Old workspace path (`~/clawd/memory/facts.db`) eliminated
- Continuity's `facts-searcher.js` repointed to core DB (default path change)
- Metabolism's `insert-facts.py` repointed to core DB
- `insert-facts.js` was already repointed on 2026-03-04
- Rationale: dual-DB caused split-brain — writes went to one, reads from another

### Category Taxonomy (14 categories, enforced)
- **New categories:** `family`, `friend` (split from `person`)
- **Removed:** `people` (duplicate of `person`), `operational` (too vague), `fact` (catch-all), `facts-db` (meta noise), `category` (meta noise), `concept` (too vague)
- **Final 14:** `person`, `family`, `friend`, `pet`, `psychedelic`, `reference`, `project`, `infrastructure`, `tool`, `decision`, `preference`, `convention`, `automation`, `workflow`
- Guardrail: `VALID_CATEGORIES` in `insert-facts.py` — metabolism cannot invent categories
- Migration: 91 facts → family, 13 → friend, 10 junk rows remapped/deleted

### Schema Updates
- `schema/facts.sql` updated to v3: includes `facts_changelog` table, enhanced `relations` with activation/decay, documented category taxonomy
- `docs/ARCHITECTURE.md` updated for single-DB, 14 categories
- `docs/tuning-knobs.md` updated stable/transient category lists

### Cleanup
- Removed `plugin-continuity-fix/` (patches upstreamed)
- Removed `plugin-graph-memory/` (retired — replaced by integrated facts search in continuity)
- Removed `.DS_Store` files

---

## v8.0 — Benchmark Overhaul + Search Telemetry (2026-02-22)

### Benchmark

**Fixed:**
- Old benchmark (`memory-benchmark.py`) had 26/60 queries pointing at nonexistent files
- Root file fallback was matching stop words, inflating scores for irrelevant files
- QMD called via `search` (BM25-only) instead of `query` (hybrid with reranking)

**Added:**
- `scripts/production-benchmark.js` — tests all 5 production search systems
  - Continuity vec (semantic similarity over conversation history)
  - Continuity BM25 (FTS5 keyword search over exchanges)
  - File-vec (semantic search over 210+ indexed workspace files)
  - Facts DB (entity/alias resolution with Hebbian activation)
  - Root files (always-loaded workspace files)
- Keyword-based evaluation (checks for expected content, not file paths)
- Per-system contribution tracking

**Found:**
- vec0 virtual table JOIN bug (`v.rowid` → `v.id`) — vector search showed 0 results in benchmark but worked fine in production
- Production result: **60/60 (100%)** across all 7 categories

### Search Telemetry

**Added:**
- Per-system timing instrumentation in continuity plugin's `before_agent_start` hook
- `~/.openclaw/data/search-telemetry.db` — logs every search with system, latency, result count, top distance, facts methods
- `scripts/search-telemetry-report.sh` — SQLite report: per-system performance, hourly breakdown, slow queries, zero-result queries, facts method distribution

### Documentation
- `docs/2026-02-22-session-report.md` — full session write-up with findings and architecture insights

---

## v7.0 — Hebbian Integration + FileIndexer + facts.db Hygiene (2026-02-22)

### Hebbian Memory (facts.db → Runtime)
- Ported `graph-search.py` to Node.js as `facts-searcher.js` inside continuity plugin
- Hooked into `before_agent_start` — facts injected as "From your knowledge base:" block
- Hebbian mechanics active: +0.5 activation per retrieval, co-occurrence wiring, daily 0.95 decay
- Removed standalone graph-memory plugin (replaced by integrated facts search)

### FileIndexer (QMD Replacement)
- Built `storage/file-indexer.js` in continuity plugin
- 210 files, 732 chunks, 768d nomic embeddings via localhost:8082
- Incremental re-index via mtime, cron every 5 min
- Results injected as "From your documents:" in context

### facts.db Hygiene
- Cleaned 4 junk values, 23 semantic dupes, pruned 222 cold facts
- Insert-time guards: semantic dedup (80% word overlap), junk filter, 500-fact cap
- Stable categories (person, pet, preference) exempt from decay
- Relations table: 36 subject/predicate/object triples for family, friends, pets

### active-context.md Cleanup
- 156 lines → 22 lines (P1 cap at 25, insert-time dedup)

---

## v6.0 — Embedding Migration + Graph Plugin + Decay System (2026-02-20)

### Embedding Stack Migration

**Changed:**
- Migrated from ONNX CPU (`all-MiniLM-L6-v2`, 384d) to llama.cpp GPU (`nomic-embed-text-v2-moe`, 768d)
- Latency: 500ms → 7ms (70x faster)
- Added multilingual support: 100+ languages including German
- Rebuilt Continuity vector index with 768d (1,847 exchanges indexed)

**Added:**
- llama.cpp Docker container on port 8082 with ROCm GPU support
- Q6_K quantization for balance of quality and speed
- Permanent VRAM pinning (~580MB)

**Removed:**
- ONNX runtime dependency
- Ollama fallback (replaced by direct llama.cpp)

### Graph-memory Plugin (Layer 12)

**Added:**
- New runtime plugin: `openclaw-plugin-graph-memory`
- Hooks `before_agent_start` event
- Extracts entities from prompt, matches against facts.db
- Injects `[GRAPH MEMORY]` context with matched entities
- Score filtering: only injects when match score ≥ 65
- Zero API cost, ~2s latency

**Files:**
- `plugin/index.js` — OpenClaw gateway plugin
- `plugin/openclaw.plugin.json` — Configuration

### Activation/Decay System

**Added:**
- `activation` column on facts table — tracks access frequency
- `importance` column on facts table — retention weight
- `co_occurrences` table — entity relationship wiring
- Decay cron: `scripts/graph-decay.py` runs daily at 3 AM
- Tiers: Hot (>2.0), Warm (1.0-2.0), Cool (<1.0)

**Current distribution:**
- Hot: 74 facts (highly accessed)
- Warm: 1,554 facts
- Cool: 1,433 facts

### Domain RAG (Layer 5a)

**Added:**
- Ebooks RAG system for integration coaching content
- 4,361 chunks from 27 documents (PDFs, markdown)
- Content: 5-MeO-DMT guides, integration literature, blog posts
- Weekly cron reindex: `scripts/ebook-rag-update.sh`
- Location: `media/Ebooks/.rag/ebook_rag.db` (74 MB)

**Note:** Currently uses brute-force cosine similarity. Should be upgraded to sqlite-vec.

### Knowledge Graph Expansion

**Scale:**
- Facts: 1,265 → 3,108 (+146%)
- Relations: 488 → 1,009 (+107%)
- Aliases: 125 → 275 (+120%)

**New content:**
- 5-MeO-DMT domain: experts, research papers, drug interactions
- Drug contraindications: MAOI, Lithium, SSRIs, SNRIs
- Brand name aliases: Prozac → Fluoxetine, Paxil → Paroxetine, etc.

### Memory Telemetry

**Added:**
- Telemetry logging: `/tmp/openclaw/memory-telemetry.jsonl`
- Tracks latency, result counts, injection status
- 571 entries (graph-memory + continuity)
- Per-prompt metrics for performance monitoring

### Documentation Updates

**Changed:**
- `docs/ARCHITECTURE.md` — Updated embedding stack, added Layers 5a and 12
- `README.md` — Updated architecture diagram, quick reference table
- `docs/COMPARISON.md` — Added documentation vs reality comparison

---

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

---

## v2.0 — Continuity Plugin (2026-02-14)

- Conversation archive with semantic search (SQLite-vec)
- Context budgeting and priority tiers
- Topic tracking and continuity anchors

---

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

## 2026-02-20 — plugins.allow Fix, Graph Telemetry Debug, Documentation

### Bug Fix
- **plugins.allow was blocking graph-memory** — the allowlist set on Feb 17 didn't include `graph-memory`, so the plugin never loaded despite being `enabled: true`. No errors were logged — it was completely silent. Fixed by adding `graph-memory` to allow list.

### plugin-graph-memory
- Added telemetry for ALL exit paths: too-short queries, no-entity-match, empty results, errors
- Debug logging for `_stripContextBlocks` behavior

### plugin-continuity
- Added QMD/BM25 telemetry via `tool_result_persist` hook

### Documentation
- Added `plugins.allow` gotcha with handler count verification method
- Updated continuity plugin section: llama.cpp GPU embeddings (768d), 60x faster
- Added Search Telemetry section with report/benchmark/tail usage
- Updated embedding options table with llama.cpp + latency comparison
- Added llama.cpp embedding server Docker setup guide
- Added nomic-embed-text task prefix documentation
