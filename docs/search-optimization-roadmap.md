# Search Optimization Roadmap

> Tracking improvements to the continuity search pipeline.
> Updated: 2026-02-22

## ✅ Done

### Quick Win 1: Parallel Search (2026-02-22)
- Changed from sequential (continuity → facts → file-vec) to `Promise.all()`
- Expected improvement: ~40-60% latency reduction (slowest system = total time, not sum)
- All 3 systems still run every query — routing comes later

### Quick Win 2: Query Preprocessing (2026-02-22)
- Strip filler words before search: "ok so how is the benchmark" → "how is the benchmark"
- Regex strips: ok, so, well, hey, alright, yeah, please, can you, could you, i think, let's, tell me
- Falls back to original if stripping removes everything (<5 chars left)
- Improves both BM25 keyword matching (fewer noise tokens) and semantic embedding quality

### Search Telemetry (2026-02-22)
- Per-system timing logged to `~/.openclaw/data/search-telemetry.db`
- Report: `scripts/search-telemetry-report.sh [hours]`

## 🔜 Telemetry-Driven (after 1 week of data)

### Adaptive Distance Threshold
- Current: hardcoded `DISTANCE_THRESHOLD = 1.0`
- Plan: analyze telemetry distribution of top distances for injected vs. cached results
- Goal: find the natural cutoff where results stop being useful

### System Weighting in RRF
- Current: all 3 systems weighted equally in RRF (k=60)
- Plan: if telemetry shows one system consistently ranks the winning result higher, increase its RRF weight
- Method: per-system k values (lower k = more weight to top results)

### Query Expansion / HyDE
- Current: raw user text → embedding
- Plan: if zero-result rate is high for certain categories, generate a hypothetical answer and embed that instead
- Risk: adds LLM call latency. Only worth it if telemetry shows significant miss rate.

### Prune Low-Value Systems
- If telemetry shows a system never contributes unique results (i.e., its results are always a subset of another system's), drop it
- Candidate: continuity-bm25 may be redundant with continuity-vec on most queries

## 🔮 Longer Term

### Implicit Relevance Feedback
- When the agent uses a retrieved fact in its response vs. ignores it → implicit signal
- Wire back into Hebbian activation scores (boost used facts, decay ignored ones)
- Requires: post-response analysis hook (does response contain retrieved content?)

### Query Routing
- Instead of running all systems every time, classify query type first:
  - Entity lookup (who/what is X?) → facts only
  - Temporal (what happened last week?) → continuity only  
  - Document (how does X work?) → file-vec only
  - Broad/unknown → all systems
- Saves latency on ~70% of queries that only need one system

### QMD Retirement Decision
- file-vec covers 53/60 benchmark queries (88%)
- If telemetry confirms file-vec handles real-world queries QMD would have caught → retire QMD cron
- Save: 134 files × daily re-index overhead
