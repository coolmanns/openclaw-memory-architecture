# Session Report: 2026-02-22 — Benchmark Overhaul & Telemetry

> Full-day session. Started with Hebbian memory integration, ended with a rewritten benchmark and live search telemetry.

## Key Findings

### 1. The Old Benchmark Was Measuring the Wrong Thing

The original `memory-benchmark.py` tested a **synthetic search path** (QMD BM25 + root file grep) that doesn't reflect how the production system works. Three bugs made results meaningless:

| Bug | Impact |
|-----|--------|
| Expected files that don't exist (26/60 queries pointed at deleted files) | Queries could never pass regardless of search quality |
| Used `qmd search` (BM25-only) instead of `qmd query` (full hybrid with reranking) | Tested the weakest search mode |
| Root file fallback matched stop words ("was", "the", "about") | SOUL.md scored higher than actual results for generic queries |

**Lesson:** A benchmark that only tests components in isolation misses how they interact in production.

### 2. Vector Search Was Working All Along

The production benchmark initially showed `continuity-vec: 0/60` and `file-vec: 0/60`. Root cause: **a 4-character bug** in the benchmark's SQL JOIN.

```sql
-- Broken (vec0 virtual tables don't expose rowid):
JOIN exchanges e ON e.rowid = v.rowid

-- Fixed:
JOIN exchanges e ON e.id = v.id
```

The actual continuity plugin uses the correct query. Vector search was contributing to every real session — we just couldn't see it in the benchmark.

### 3. Production Search Quality Is Solid

With the corrected benchmark (`production-benchmark.js`), all 5 systems contribute:

| System | Hits/60 | What it does |
|--------|---------|-------------|
| Root files | 57 | Always-loaded workspace files (USER.md, TOOLS.md, etc.) |
| File-vec | 53 | Semantic search over 210 indexed workspace files (768d nomic-embed) |
| Continuity BM25 | 48 | FTS5 keyword search over 2,599 conversation exchanges |
| Continuity vec | 44 | Semantic similarity search over conversation history |
| Facts DB | 31 | Entity/alias resolution (Mama→Heidi, JoJo→Johanna) + Hebbian activation |

**Result: 60/60 (100%)** — but honestly, root files carry most of it. The real value of the search systems shows on queries about past conversations, project history, and alias resolution.

### 4. Search Telemetry Now Live

Instrumented the continuity plugin's `before_agent_start` hook with per-system timing:

```
~/.openclaw/data/search-telemetry.db
├── search_log table
│   ├── ts, agent_id, query
│   ├── system (continuity | facts | file-vec)
│   ├── latency_ms
│   ├── result_count, top_distance
│   ├── methods (facts: entity_intent, fts, etc.)
│   └── context_injected (did results make it into prompt?)
```

Report: `./scripts/search-telemetry-report.sh [hours]`

This gives us **real production data** over time — not curated benchmark queries. After a week of telemetry we'll know exactly which system is pulling its weight and which queries fall through the cracks.

## Changes Made

### New Files
| File | Purpose |
|------|---------|
| `scripts/production-benchmark.js` | Tests all 5 search systems against 60 queries with keyword-based evaluation |
| `scripts/search-telemetry-report.sh` | SQLite report over telemetry data (per-system latency, zero-results, slow queries) |
| `~/.openclaw/data/search-telemetry.db` | Auto-created on first query after restart |

### Modified Files
| File | Change |
|------|--------|
| `scripts/memory-benchmark.py` | Fixed expected file paths to match current workspace (26 broken targets → corrected). Fixed facts.db path. |
| `~/.openclaw/extensions/openclaw-plugin-continuity/index.js` | Added telemetry instrumentation around continuity search, facts search, and file-vec search |
| `projects/openclaw-memory-architecture/docs/benchmark-results.md` | Added production benchmark results, clarified legacy vs production benchmark |

## Architecture Insight

**Structure > Embeddings, but Context > Everything.**

The root files being loaded every session (SOUL.md, USER.md, TOOLS.md, AGENTS.md, MEMORY.md, IDENTITY.md, HEARTBEAT.md) answer 95% of questions without any search at all. They're ~4,750 tokens — 2.4% of the 200K context budget — and they cover identity, contacts, tools, operations, and memory.

The search systems earn their keep on the **remaining 5%**: temporal queries ("what happened last week"), alias resolution ("Mama's phone number"), and document retrieval for files not in the root set. That 5% is where quality matters — and that's what the telemetry will measure.

## Next Steps

1. **Collect telemetry for 1 week** — real queries, real latencies, real miss rates
2. **Analyze zero-result queries** — these are the actual gaps in our coverage
3. **Decide on QMD** — if file-vec (53/60) covers what QMD does, we can retire the QMD cron
4. **Benchmark drift detection** — run `production-benchmark.js` weekly via cron, alert on regression
