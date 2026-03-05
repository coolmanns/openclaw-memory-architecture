# Tuning Knobs — Memory & Metabolism Configuration

> All the dials in one place. When something feels off, check here first.
> Last updated: 2026-03-05

## Metabolism (processing pipeline)

| Knob | Where | Current | What it does |
|------|-------|---------|--------------|
| `maxCandidatesPerCycle` | `openclaw.json` → metabolism config | 2 | How many conversation candidates get processed per cron run |
| Cron interval | `crontab -l` | Every 5 min | How often metabolism processes candidates |
| `entropyMinimum` | metabolism config | 0.6 | Minimum entropy score for a conversation to become a candidate (higher = pickier) |
| P0-P3 classification | `processor.js` prompt | LLM decides | The LLM prompt defines what counts as P0 vs P1 vs P2 vs P3 |
| facts-db routing | `processor.js` prompt | LLM decides | LLM chooses whether extracted facts go to facts.db, active-context, daily file, or nowhere |

**Throughput math:** 2 candidates × 12 runs/hour = 24 candidates/hour max. If conversations generate more than that, backlog grows. Bump `maxCandidatesPerCycle` to 5-8 if queue stays >20.

**LLM timeout:** 60s (was 30s). The 14B model is slower under GPU contention (active Opus sessions). 60s prevents false timeouts while still catching real hangs.

## facts.db (knowledge base)

| Knob | Where | Current | What it does |
|------|-------|---------|--------------|
| `MAX_FACTS` | `insert-facts.js` | 500 | Hard cap. Coldest non-permanent facts get pruned when exceeded |
| Semantic dedup threshold | `insert-facts.js` → `isSimilar()` | 80% word overlap | How aggressively near-duplicates are rejected |
| Junk patterns | `insert-facts.js` → `JUNK_PATTERNS` | 7 patterns | Values matching these are rejected on insert |
| Blocked keys | `memory-guardrails.json` or fallback in code | status, pid, topic, etc. | Keys that are never inserted |
| Blocked entities | `memory-guardrails.json` or fallback | User, System, Plugin, Session | Entity names that are rejected |
| Valid categories | `insert-facts.py` → `VALID_CATEGORIES` | 14 categories | person, family, friend, pet, psychedelic, reference, project, infrastructure, tool, decision, preference, convention, automation, workflow |
| Hebbian decay rate | `continuity/index.js` | 0.95/day | How fast unused facts lose activation (lower = faster decay) |
| Decay floor | `continuity/index.js` | 0.01 | Facts below this get pruned on next cap enforcement |
| Person fact cap | `insert-facts.js` | 2 per entity+key | Max entries for same person + same key |
| Relations per candidate | `processor.js` parser | 5 max | Max relationship triples extracted per conversation |
| Blocked predicates | `processor.js` parser | related_to, associated_with, connected_to, involves | Generic predicates rejected on parse |
| Stable predicates | `processor.js` routing | family/location predicates | Born permanent (partner_of, father_of, lives_in, etc.) |
| Stable categories | `insert-facts.py` → born permanent | family, friend, person, pet, psychedelic, decision, preference | Born permanent, never decay. Relationships, preferences, and key decisions are protected. |

**Stable vs transient categories:** Family/friend/person/pet/psychedelic/decision/preference facts represent enduring knowledge (relationships, birthdays, legal boundaries). They're marked permanent on insert and exempt from decay+pruning. Infrastructure/project/tool/automation/workflow/convention/reference facts are transient — they decay naturally and get pruned when the cap is hit.

**Category enforcement:** The `VALID_CATEGORIES` set in `insert-facts.py` is the guardrail. Metabolism cannot invent new categories — facts with invalid categories are rejected at insert time. Added 2026-03-05.

**Scaling concern:** At 500 cap with 5+ active projects, each project gets ~60-80 fact slots (after permanent facts take 146). If projects grow significantly, consider raising to 750.

## active-context.md (working memory)

| Knob | Where | Current | What it does |
|------|-------|---------|--------------|
| P1 cap | `processor.js` | 25 | Max P1 items before oldest gets evicted. P0 unlimited. |
| Dedup sensitivity | `processor.js` | First 60 chars normalized | How aggressively similar P1s are rejected |
| Target size | Convention (AGENTS.md) | <2KB | Human-set goal for file size |
| Stale threshold | `active-context-health.sh` | 3 days | Items older than this flagged as stale |

**Scaling concern:** 25 P1s across 5 projects = 5 per project. If you're actively working 8+ projects, raise to 35-40 or implement per-category caps.

## Continuity (conversation memory)

| Knob | Where | Current | What it does |
|------|-------|---------|--------------|
| Facts search results | `continuity/index.js` | Top 5 injected | How many facts.db results appear in "[From your knowledge base]" |
| Min query length | `continuity/index.js` | 5 chars | Queries shorter than this skip facts search |
| Embedding model | `continuity/storage/indexer.js` | nomic-embed-text-v2-moe (768d) | Vector model for semantic search |
| Embedding endpoint | Config / env | localhost:8082 | llama.cpp server for embeddings |

## QMD (document search)

| Knob | Where | Current | What it does |
|------|-------|---------|--------------|
| Reindex interval | `crontab -l` | Every 30 min | How often QMD re-scans files |
| Collections | QMD config | 5 collections | Which directories get indexed |

## Health Scripts

| Script | What it checks |
|--------|---------------|
| `scripts/facts-health.sh` | facts.db: total, junk, dupes, accessed ratio, entropy |
| `scripts/active-context-health.sh` | active-context: lines, bytes, P1 count, stale items |
| `scripts/watchdog.sh` | Gateway, disk, backup freshness, metabolism, memory, dashboard |

---

*When adding new knobs, update this file. Future you will thank present you.*
