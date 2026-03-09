# Project Memory — OpenClaw Memory Architecture

> Institutional knowledge for the memory architecture project.
> GitHub: `coolmanns/openclaw-memory-architecture` (public)
> Last updated: 2026-03-07

## Mission

Provide a reusable, multi-layered memory system for OpenClaw agents that combines structured storage, semantic search, and cognitive patterns. Open-source reference architecture that any OpenClaw user can adopt.

## What It Is

- **README.md** — full architecture guide (v2.2), posted to GitHub Discussions #17824
- **docs/ARCHITECTURE.md** — deep technical reference
- **docs/embedding-setup.md** — local vs remote embedding setup
- **docs/code-search.md** — code-aware search patterns
- **schema/** — fact database schema
- **scripts/** — pruning, maintenance scripts
- **templates/** — starter files (AGENTS.md, MEMORY.md, etc.)

## Key Concepts

1. **Multi-layered recall** — facts.db for exact lookups, semantic search for fuzzy recall, daily files for timeline
2. **Wake/sleep lifecycle** — read on boot, write before compaction
3. **Importance tagging** — i≥0.8 permanent, 0.4-0.8 kept 30 days, <0.4 pruned after 7 days
4. **Active context** — <2KB working memory, updated every session
5. **Gating policies** — failure prevention rules learned from actual mistakes

## Facts Architecture (consolidated 2026-03-04)

Single source of truth:

| Component | Path/Detail |
|-----------|-------------|
| **Core facts.db** | `~/.openclaw/data/facts.db` — single DB, Hebbian schema |
| **Writer** | Metabolism via `insert-facts.js` — every 5 min, Qwen3-30B-A3B, 10 guardrails |
| **Readers** | Continuity FactsSearcher, Mission Control Facts Graph, `memory_search` tool |
| **Guardrails** | `~/clawd/config/memory-guardrails.json` — blocked keys/entities/patterns, category caps |
| **Schema** | Auto-increment ID, Hebbian (decay_score, activation, importance), FTS5, changelog, co-occurrences |

- Workspace `~/clawd/memory/facts.db` retired (renamed `.retired-20260304`)
- `insert-facts.js` adapted for core schema (separate INSERT/UPDATE, Hebbian defaults, FTS row updates)
- Guardrails tightened: blocks `.js`/`.md`/`.db` entities, plugin internals, agent metadata
- Category caps raised (2026-03-06): person 125, project 175, infrastructure 150, family 125, decision/preference 75, DEFAULT_CAP 75
- Facts cleanup (2026-03-06): 58 recategorized (person junk drawer → correct categories), 53 entity merges, 2 dupes deleted. Script: `scripts/facts-cleanup.py`
- **Task #97:** ✅ DONE (2026-03-06) — Fixed extraction quality: metadata stripping in `_formatConversation()`, entity normalization via `_normalizeEntity()`, relation category inference via `_inferRelationCategory()`, 18 new tests

## What's Been Shared

- GitHub Discussions #17824 (Show and tell) — v2.1 (needs update to v2.3)
- v2.3 pushed 2026-03-06: contemplation pipeline, GAPS extraction, metabolism quality fixes, guardrails template
- v2.2 pushed 2026-03-05: single-DB, 14 categories, retired plugin dirs
- Discord post drafted but not posted (bot not in OpenClaw server)
- Moltbook post failed (account suspended)

## Fork Status

| Plugin | Upstream | Our Fork | Key Differences |
|--------|----------|----------|-----------------|
| Continuity | CoderofTheWest | coolmanns/openclaw-plugin-continuity | facts.db repoint, config, manifest |
| Metabolism | CoderofTheWest | coolmanns/openclaw-plugin-metabolism | GAPS extraction, gap forwarding, entity normalization, metadata stripping, guardrails, entropy context header parsing (fixes upstream bug — api.stability scoping) |
| Stability | CoderofTheWest | coolmanns/openclaw-plugin-stability | Semantic emotion scoring (Plutchik + nomic-embed), valence gate, Shannon entropy, debt tracking, intensity scaling, Telegram envelope stripping, expanded keywords |
| Lossless-claw (LCM) | Martian-Engineering | coolmanns/lossless-claw | Configurable summary model (`summaryModel` config + schema), decouples summarization from session model |
| Contemplation | CoderofTheWest | coolmanns/openclaw-plugin-contemplation | resolveApiKey fix for tagInquiry (was always null), gap ingestion maxAge 1h→24h |
| Nightshift | CoderofTheWest | coolmanns/openclaw-plugin-nightshift | Failed cycle counting fix, caps bumped (maxPerNight 3→20, maxCycles 10→30), timezone→America/Chicago |
| Graph | CoderofTheWest | (no fork — installed untracked) | — |

README install instructions point to our forks for continuity, metabolism, stability, contemplation, and nightshift. Graph uses upstream.

## Landscape — What Others Are Building

Projects solving adjacent memory/stability problems for AI agents. Validates our patterns and surfaces ideas we haven't considered.

### openclaw-plugin-continuity (github.com/CoderofTheWest/openclaw-plugin-continuity)
- **What:** "Infinite Thread" — persistent cross-session memory plugin for OpenClaw
- **Author:** CoderofTheWest
- **Stack:** SQLite + sqlite-vec (384-dim embeddings), JSON daily archives, OpenClaw plugin hooks
- **Key innovations:**
  - **Proprioceptive framing** — retrieved memories use first-person language ("They told you:" / "You said:") instead of third-person ("Archive contains:"). Solves the identity integration problem where LLMs don't recognize retrieved data as their own experience.
  - **Temporal re-ranking** — blends semantic similarity with recency boost (half-life 14 days). Corrections naturally outrank the statements they correct. `compositeScore = semanticDistance - exp(-ageDays/halfLife) * weight`
  - **Noise filtering** — strips meta-questions about memory ("do you remember X?") which otherwise rank higher in semantic search than actual substantive content.
  - **Context budgeting** — token allocation across priority tiers (recent turns get 3000 chars, mid turns 1500, older 500).
  - **Tool result enrichment** — intercepts OpenClaw's built-in memory_search when it returns sparse results, enriches with archive data.
  - **AGENTS.md vs MEMORY.md separation** — behavioral instructions in AGENTS.md (system-prompt authority), curated memory in MEMORY.md (agent's space). Aligns with our architecture.
- **How it compares to ours:**
  - They auto-archive everything, filter on retrieval. We curate manually, write what matters.
  - They use temporal decay for retention. We use importance scoring (i=0.3 to 0.9).
  - They solve the proprioceptive problem explicitly. We rely on SOUL.md + agent discipline.
  - We have structured facts (facts.db) for exact lookups. They're all semantic search.
- **Ideas worth adopting:**
  1. First-person framing in retrieved context
  2. Noise filtering for meta-questions
  3. Temporal re-ranking (corrections outrank originals)
- **Discovered:** 2026-02-17

### openclaw-plugin-stability (github.com/CoderofTheWest/openclaw-plugin-stability)
- **What:** Agent stability, introspection & anti-drift framework for OpenClaw
- **Author:** CoderofTheWest (same author as continuity plugin)
- **Stack:** Model-agnostic text analysis, OpenClaw plugin hooks, SQLite for growth vectors
- **Key innovations:**
  - **Shannon entropy monitoring** — quantitative measure of cognitive turbulence per turn. Combines signals: user corrections, novel concepts, recursive self-reference, unverified claims. Sustained high entropy (>45 min) = warning.
  - **Confabulation detection** — catches when agent discusses plans as if already implemented (temporal mismatch). We hit this constantly with ClawSmith agents.
  - **Loop detection** — same tool 5x in a row, same file read 3x = stuck. Simple but prevents the most common agent failure mode.
  - **Structured heartbeat decisions** — every heartbeat produces exactly ONE decision: GROUND / TEND / SURFACE / INTEGRATE. No freeform rambling. Last 3 carry forward between heartbeats.
  - **Growth vectors** — when agent acts consistently with SOUL.md principles, it's recorded as durable evidence of principled behavior. Identity accumulates over time instead of resetting.
  - **Awareness injection** — tiny ~500 char context block before each turn with entropy score, recent decisions, principle alignment. Agent proprioception without token burn.
  - **Quality decay detection** — catches forced depth in response to brief user input.
  - **Recursive meta-spiral detection** — catches agent getting lost in self-referential loops.
- **How it compares to ours:**
  - We have no quantitative session health metric (they have entropy scoring)
  - We caught confabulation manually during ClawSmith. They detect it systematically.
  - Our heartbeats are freeform (HEARTBEAT.md). Theirs are structured single-decision.
  - We have SOUL.md principles but don't track alignment mathematically.
  - We have gating policies (GP-XXX) for failure prevention — similar intent, different mechanism.
- **Ideas worth adopting:**
  1. Entropy scoring (or simplified version) as session health metric
  2. Confabulation detection (temporal mismatch) — especially for BUILD agents
  3. Structured heartbeat decisions (one of GROUND/TEND/SURFACE/INTEGRATE)
  4. Growth vectors — principled behavior as durable records
- **Discovered:** 2026-02-17

### openclaw-plugin-graph (github.com/CoderofTheWest/openclaw-plugin-graph)
- **What:** Knowledge graph — entity extraction, triple storage, graph-based retrieval
- **Author:** CoderofTheWest
- **Stack:** compromise.js NLP, better-sqlite3, recursive CTE traversal, OpenClaw plugin hooks
- **Key innovations:**
  - **Real-time NLP extraction** — compromise.js extracts entities (people, places, orgs) + regex patterns for URLs/emails/mentions. Sub-millisecond per exchange. No LLM needed for fast path.
  - **Triple store** — subject → predicate → object with confidence scores, exchange provenance, mention counts. 12 canonical predicates: knows, created, uses, works_on, interested_in, located_in, part_of, prefers, related_to, has_property, occurred_at, causes.
  - **Multi-hop traversal** — recursive CTE walks up to N hops (default 2), bidirectional. "Chris knows Dan, Dan created dashboard" surfaces in Chris queries.
  - **Meta-path patterns** — predicate-sequence patterns like [knows, works_on]. 5 static defaults + automatic discovery during nightshift.
  - **Gazetteer** — builds known-entity list from DB, improves extraction over time. Entity resolution: 3-tier (assume >0.8, ask <0.4, defer 0.4-0.8).
  - **RRF fusion with continuity** — publishes results via `global.__ocGraph.lastResults[agentId]`, continuity picks up for 3-way RRF (semantic + keyword + graph).
  - **Archive backfill** — retroactive extraction from existing continuity archives on first run.
  - **LLM enrichment** — queues exchanges for deeper extraction during nightshift (optional).
- **How it compares to facts.db:**
  - facts.db = phonebook (entity → key-value properties, FTS5, direct lookup)
  - Graph = map (relationship triples with traversal, connected knowledge)
  - Complementary, not competing. Graph shines on relationships between entities; facts.db on properties of one entity.
- **Extraction patterns worth porting to insert-facts.js:**
  1. NLP pre-filter (compromise.js) before LLM extraction — identify entities before Qwen processes
  2. Gazetteer seeded from existing facts.db entities — resolve "Martin" → "Martin Ball"
  3. Typed/constrained keys instead of freeform LLM invention
  4. Real-time extraction for high-confidence patterns (emails, URLs, dates) via agent_end hook
- **LLM config:** `:8084` / Qwen3-30B-A3B (config label corrected 2026-03-06 from stale "Qwen3-14B")
- **Task:** #91 (evaluate, install standalone without nightshift, port extraction patterns)
- **Discovered:** 2026-02-21 | **Evaluated:** 2026-03-05

### openclaw-plugin-crystallization (github.com/CoderofTheWest/openclaw-plugin-crystallization)
- **What:** Growth vector → permanent character trait pipeline. The consumer for stability's growth vectors.
- **Author:** CoderofTheWest
- **Stack:** Ollama LLM for classification, JSON file storage, OpenClaw plugin hooks
- **Key innovations:**
  - **Three-gate conjunction model** — all must pass: (1) Time gate: vector must be ≥30 days old, (2) Principle alignment: LLM classifies vector against agent's principles, (3) Human approval: user says yes/no/edit.
  - **Principle classification** — LLM evaluates which principle each vector aligns with, needs minVectors (default 3) aligned to same principle before proposing.
  - **Natural approval flow** — proposes trait in conversation, user responds naturally (yes/no/edit: revised text). No special command interface.
  - **Provenance tracking** — crystallized traits record source vectors, principle, approval timestamp, approver.
  - **Calibration mode** — can run during training phase, build character, then disable. Traits persist independently of plugin.
- **Why it matters for us:** Growth vectors (87 candidates, 0 promoted as of 2026-03-05) had no consumer. Crystallization IS the promotion pipeline. Free-text vectors become permanent character traits with human oversight.
- **Our principles to configure:** integrity, directness, reliability, privacy, curiosity (from SOUL.md/stability)
- **Dependencies:** stability plugin (installed), nightshift (we'll use cron instead)
- **Task:** #92 (evaluate, install, configure principles)
- **Discovered:** 2026-03-05

### Combined Insight
CoderofTheWest is building a coherent agent metacognitive stack:
- **Continuity** = what the agent remembers (memory layer) — *installed, forked*
- **Stability** = how the agent behaves (cognitive health layer) — *installed, forked*
- **Graph** = what the agent knows about relationships (knowledge layer) — *Task #91*
- **Crystallization** = how the agent evolves (identity layer) — *Task #92*
- **Nightshift** = when background work happens (scheduler) — *skipped, using cron*
- **Contemplation** = deep reflection sessions — *✅ installed 2026-03-06, heartbeat-driven, Qwen3-30B*

Together they form a complete metacognitive loop: observe behavior → extract knowledge → crystallize identity → enhance recall. We run 5/7 (stability, continuity, metabolism, contemplation, nightshift). Contemplation pipeline fixed 2026-03-09 (API key resolution + gap ingestion window + nightshift cycle counting). 63 inquiries queued, first successful processing cycle expected tonight. Graph **killed** (2026-03-06, 32% precision audit — extraction patterns ported to metabolism via Task #91). Nightshift skipped (heartbeat + cron). Crystallization next (Task #92, after contemplation proven).

**Task #91 (Port Graph Extraction Patterns → Metabolism) — Phase 1 complete:**
- ✅ Constrained predicates: 39 canonical predicates, parser rejects freeform
- ✅ Gazetteer: top 100 facts.db entities injected into LLM prompt
- ✅ 26 new tests passing, 9 existing tests still passing
- ⬜ Real-time regex extraction via agent_end hook (future)
- ⬜ NLP pre-filter with compromise.js (stretch)

**Pipeline status (2026-03-06 evening):** Metabolism → GAPS extraction → gapListeners → Contemplation inquiry queue → heartbeat passes. First end-to-end test successful (6 gaps from 3 candidates). Awaiting first completed contemplation pass cycle (~24h).

**LLM config alignment (2026-03-06 night):**
- Discovered contemplation was configured to hit `localhost:11434` (dead endpoint, DeepSeek cloud model) — LLM calls were failing silently, explaining 0 vector promotions
- Fixed: all three LLM-consuming plugins now aligned to same endpoint + model:
  - Metabolism: `:8084` / Qwen3-30B-A3B ✅
  - Graph: `:8084` / Qwen3-30B-A3B ✅ (config label also corrected from stale "Qwen3-14B")
  - Contemplation: `:8084` / Qwen3-30B-A3B ✅ (was `localhost:11434` / `deepseek-v3.1:671b-cloud`)

## Hebbian Decay Status
- Schema columns exist (decay_score, activation, importance) — added 2026-02-22
- facts-searcher.js line 443: stub only ("full implementation pending")
- Daily maintenance cycle in continuity index.js (lines 825-868) calls decay but hits stub
- **Task #93:** Implement actual decay logic, wire into search ranking

## Growth Vector Refinement Pipeline (ADR-002, 2026-03-06)

**Status:** ✅ DONE (Task #95 closed 2026-03-06)

### The Problem
Metabolism produces growth vector candidates (343 at time of analysis), but nothing consumes them. Triage run showed 64% noise, 30% signal, 6% duplicate. Root cause: metabolism feeds raw conversation with metadata blocks to LLM.

### The Solution — Install Contemplation Plugin + Fix Input Quality

**Step 1: Fix metabolism data quality** (Task #97) ✅ DONE
- `_stripMetadata()` — strips CONTINUITY/STABILITY context, sender/conversation JSON, inbound_meta, TOPIC NOTE lines
- `_inferRelationCategory()` — derives category from predicate (person/infrastructure/project/reference) instead of hardcoded 'person'
- `_normalizeEntity()` — resolves aliases from facts.db aliases table + hardcoded defaults (Sascha → Sascha Kuhlmann)
- Entity normalization wired into both facts and relations parsing in `_parseGatedResponse()`
- Relations in `_routeToDestination()` now use inferred category instead of hardcoded 'person'
- Fixed stale `_parseImplications` test → updated to `_parseGatedResponse` API
- **Test suite:** `test-task97.js` — 18 tests covering metadata stripping, parsing, category inference, entity normalization
- Clean input → cleaner facts + cleaner growth vectors

**Step 2: Install contemplation plugin** ✅ DONE (2026-03-06)
- Cloned from `github.com/CoderofTheWest/openclaw-plugin-contemplation` → `~/.openclaw/extensions/`
- LLM endpoint: `localhost:8084/v1/chat/completions` (Qwen3-30B-A3B, shared with metabolism + contemplation)
- maxTokens: 700 → 1500, timeout: 60s
- Heartbeat-based pass execution (re-added — upstream removed it in favor of nightshift-only)
- No nightshift dependency — heartbeat fallback skips if nightshift is present (forward-compatible)
- Pass timing: immediate → 4h → 20h (upstream defaults)
- Plugin loads after metabolism in `openclaw.json` (correct ordering for gap bus subscription)
- Metabolism timeout aligned to upstream: 30s → 60s

**Step 2b: Wire contemplation inputs** ✅ DONE (2026-03-06 evening)
- **Bug found:** Metabolism never called `gapListeners.forEach()` — gaps extracted but never forwarded to contemplation
- **Bug found:** `_extractGaps()` used regex on implications — only 2 matches in 2,900+ candidates (implications are declarative, not questions)
- **Bug found:** Conversation extractor entropy threshold 0.5 too high for most live sessions (0.15-0.30)
- **Fix 1:** Added `GAPS:` section to metabolism LLM prompt (Step 5) — asks for 0-2 explicit knowledge gap questions
- **Fix 2:** Added gaps parsing in `_parseGatedResponse()` — falls back to regex `_extractGaps()` if LLM produces none
- **Fix 3:** Wired `gapListeners.forEach()` in metabolism `index.js` after `processBatch()` returns
- **Test:** Manual run on 3 candidates → 6 gaps extracted, LLM producing real questions
- **First inquiry queued:** "How do you handle schema evolution with Apache AGE?" (from conversation extractor)
- Reminder set for 2026-03-07 21:00 CST to verify full pipeline output

**Step 3: Crystallization** (Task #92, after contemplation proven)

### Validated by Triage Run (2026-03-06)
- Built `scripts/reflect-triage.mjs` — classified all 343 candidates via local Qwen3-30B
- Results: 104 signal / 219 noise / 19 duplicate / 1 unclassified
- Proved local LLM can classify growth vectors accurately
- Script retained as one-off cleanup/validation tool

### Infrastructure Changes (already applied)
- Metabolism cron: `*/30` → `*/5` (restored fast cycle)
- llama-metabolism: `-c 8192`, `--parallel 2`, `--reasoning-format none`
- `--reasoning-format none` required for Qwen3 models (fixes `<think>` tag crash)
- Metabolism LLM backend: Anthropic Sonnet (switched from local Qwen3)

See: `docs/adr/002-contemplation-implementation.md`

## Recent Work (2026-03-07): Learning Loop Fix

### Dev-Extend Workflow — 10 tasks + 4 tests completed
- Code review found 3 broken pathways → all fixed
- Load order swap: nightshift before contemplation (contemplation task runner now registers)
- Gap file queue: metabolism cron → pending-gaps.json → contemplation heartbeat
- Auto-promotion: VectorStore.addCandidate() routing (was raw push, no recurrence tracking)
- Facts invalidation: superseded_at column + FactsSearcher filtering
- Contemplation LLM: Qwen3 → Anthropic Sonnet

### Pipeline Status (2026-03-08)
- Metabolism: ✅ Sonnet backend, gaps + vectors flowing, **main agent only** (Task #108)
- Contemplation: ✅ Registered with nightshift, cron trigger deployed (23:00-08:00 every 30min)
- Nightshift: ✅ `runCycle` gateway method live, morning detection filter applied
- Growth vectors: ⚠️ 19 active (deduped), quality needs work (Task #102 — behavioral vs operational)
- Facts: ✅ superseded_at invalidation active
- LCM: ✅ Context engine active, ingesting, FTS operational
- **All memory plugins: main agent only** — spiritual-dude, cron-agent silently skipped (Task #108)

### LIVE: Lossless Context Management (Task #109)
- **Status:** ✅ ACTIVATED (2026-03-08) — context engine slot configured, schema bootstrapped, ingesting
- lossless-claw v0.2.3 replaces OpenClaw's legacy compaction with immutable SQLite store + summary DAG
- Config: `plugins.slots.contextEngine: "lossless-claw"` in `openclaw.json`
- DB: `~/.openclaw/lcm.db` — 21 tables, FTS5 indexed, 372+ messages after first session
- Seeded with all 12 PROJECT.md files (1 MB DB after initial session)
- Does NOT replace: facts.db, metabolism, stability, contemplation, continuity cross-session archive
- Continuity shifts from "context owner" to "facts enricher" — needs `prependSystemContext` migration
- **Summary model override:** `summaryModel` config option added to our fork — decouples summarization model from session model. Set in `plugins.entries.lossless-claw.config.summaryModel`. Currently using `anthropic/claude-sonnet-4-6` for summaries while main agent runs Opus. Precedence: env var `LCM_SUMMARY_MODEL` → plugin config `summaryModel` → session model.
- **Known risks:**
  - Tool I/O stored verbatim — no secrets scrubbing (CRITICAL, not yet addressed)
  - `prependContext` plugins (continuity, stability) pollute the DAG with metadata
- Repo: https://github.com/Martian-Engineering/lossless-claw (upstream) | https://github.com/coolmanns/lossless-claw (our fork)
- Evaluation: 5 OpenProse reports in `projects/lossless-claw-eval/`

### LCM Backend in memory_search (2026-03-08)
- **Status:** ✅ LIVE — `lcm` is now the fourth backend in `memory_search` alongside continuity, facts, files
- Default systems string: `continuity,facts,files,lcm`
- Uses FTS5 indexes on `lcm.db` (both `messages_fts` and `summaries_fts`)
- Opens lcm.db read-only, runs in parallel with other backends — no latency hit
- Returns messages (with role, date, snippet) and summaries (with summary_id, kind, depth, date, snippet)
- Complements continuity's semantic/vector search with text-based search over the lossless record
- For deep DAG expansion, `lcm_expand_query` remains a separate dedicated tool
- **Files changed:** `~/.openclaw/extensions/openclaw-plugin-continuity/index.js` — added LCM system block (FTS5 query, result formatting, telemetry)

### Open: Task #102
- Growth vector extraction prompt outputs operational noise as "insights"
- Dashboard schema mismatch (needs area/direction/priority fields)
- Metabolism pipeline v2 redesign still parked

### Metabolism Pre-Filter (2026-03-07)
- Added 10+ `_stripMetadata()` patterns: heartbeat prompts, NO_REPLY, SKILL SUGGESTION, session startup, memory flush, queued message headers, continuity/document recall blocks
- **Deployment gotcha:** workspace copy (`~/clawd/plugins/metabolism/`) ≠ runtime copy (`~/.openclaw/extensions/`). Must sync before restart.
- Verified end-to-end: raw candidates with noise come out clean after `_formatConversation()`

### Growth Vector Dedup (2026-03-07)
- Built `scripts/growth-vector-dedup.py` — Jaccard similarity (0.45 threshold) + noise pattern pruning
- Results: 902 → 736 candidates, 7 became promotable, **19 total vectors** now (was 2)
- Script is rerunnable, safe to add to periodic maintenance
- Key insight: many candidates were the same observation with slightly different wording — recurrence tracking missed them without semantic similarity

### Anthropic SDK Auth Fix (2026-03-07)
- Metabolism cron failed with `invalid x-api-key` after gateway restart — OAuth tokens rotated
- **Fix:** Replaced raw axios calls with `@anthropic-ai/sdk` from OpenClaw's node_modules
- SDK handles `sk-ant-oat` tokens natively when passed as `apiKey` — no manual OAuth exchange needed
- Also added OpenRouter backend (unused, ready as fallback)
- OMA dashboard field mapping fixed: metabolism vectors now display correctly (19/19 showing)
- **Task #104** ✅ completed: unified growth vector schema — `area`/`direction`/`priority` on all vectors, migration ran (19 vectors + 754 candidates), 15 tests, dead fields pruned

## Per-Agent Plugin Scoping (Task #108, 2026-03-08)

**Status:** ✅ Code changes done, awaiting restart + verification

### Problem
All memory plugins (metabolism, stability, contemplation) ran for every agent — spiritual-dude, cron-agent, etc. generated candidates/state that never got processed, wasting resources and creating orphaned data.

### Design Decision
**Option A: Per-plugin agent allowlist** — each plugin reads `config.agents` (array of agent IDs). Default: `['main']`. Agents not in the list are silently skipped at every hook entry point.

Option B (per-agent plugin config) was rejected — would require cleaning up all partially-configured agents.

### Implementation
Identical pattern in all three plugins:
```js
const allowedAgents = config.agents || ['main'];
function isAgentAllowed(agentId) {
    return allowedAgents.includes(agentId || 'main');
}
```

Gate added at top of every hook (`agent_end`, `before_agent_start`, `before_compaction`, `after_tool_call`, `heartbeat`, `session_end`).

| Plugin | Hooks Gated | Notes |
|--------|-------------|-------|
| **Metabolism** | `agent_end`, `before_compaction`, `session_end` | 3 hooks, verbose log on skip |
| **Stability** | `before_agent_start`, `agent_end`, `after_tool_call`, `before_compaction` | 4 hooks, returns `{}` on before_agent_start skip |
| **Contemplation** | `agent_end`, `heartbeat`, `session_end` | 3 hooks |
| **Continuity** | Already scoped | Has `agentFeatures()` with per-agent feature flags since earlier |

### Config
No config change needed — defaults to `['main']` which covers both main agent and mission-control (same agentId). To add agents later:
```json
"openclaw-plugin-metabolism": {
  "config": {
    "agents": ["main", "some-other-agent"],
    ...
  }
}
```

### Key Insight
mission-control is NOT a separate agent — it's session key `agent:main:mission-control` with `agentId: main`. No special handling needed.

### Files Changed
- `plugins/metabolism/index.js` + synced to `~/.openclaw/extensions/openclaw-plugin-metabolism/index.js`
- `plugins/stability/index.js` + synced to `~/.openclaw/extensions/openclaw-plugin-stability/index.js`
- `~/.openclaw/extensions/openclaw-plugin-contemplation/index.js` (edited in-place, no workspace copy)

### ⚠️ Important: Main Agent Only
After this change, metabolism, stability, and contemplation **only process for the main agent**. All other agents (spiritual-dude, cron-agent, etc.) are silently skipped. Continuity has its own per-agent feature flags (already configured). To add an agent to any plugin, add its ID to the `agents` array in that plugin's config.

## Nightshift Pipeline Fix (2026-03-08)

**Status:** Code done, awaiting restart

### Root Cause
Nightshift processes tasks during heartbeat hooks, but heartbeats run 08:00-23:00 and nightshift office hours are 23:00-08:00 — **zero overlap**. Additionally, the morning briefing cron (4 AM) falsely triggered morning detection because "morning" is in the default `morningPhrases` config.

### Fixes
1. **`nightshift.runCycle` gateway method** — cron-triggered processing, bypasses heartbeat dependency
2. **`contemplation.ingestAndQueue` global** — nightshift triggers gap ingestion + pass self-queuing (solves in-memory queue volatility on restart)
3. **Morning detection filter** — `agent_end` skips heartbeat/cron turns
4. **Nightshift cron** — `scripts/nightshift-cron.sh`, every 30 min during 23:00-07:59

### Files Changed
- `~/.openclaw/extensions/openclaw-plugin-nightshift/index.js` — `runCycle` method + cron turn filter
- `~/.openclaw/extensions/openclaw-plugin-contemplation/index.js` — `ingestAndQueue` global
- `scripts/nightshift-cron.sh` — new
- Crontab: `*/30 23,0-7 * * *`

## Entropy System Overhaul (2026-03-08)

**Status:** ✅ DEPLOYED — semantic emotion scoring live, valence gate active

### Problem
Entropy scoring was a crude keyword matcher inherited from upstream (CoderofTheWest). All categories were boolean (single hit = fixed score). Emotional keywords were almost entirely positive/observer-perspective, tuned for the Oct 31 Strange Loop breakdown. Real user frustration ("I'm super frustrated") scored **0.00**. The sophisticated downstream machinery (growth vectors, contemplation, metabolism thresholds) was starved by the crude upstream signal.

### Changes Made (6 rounds)

**Round 1 — Upstream alignment:**
- Correction weight: +0.40 → +0.26 (matches Clint upstream)
- Shannon entropy integrated: `calculateShannonEntropy()` (was dead code) now provides novelty boost or repetition penalty in composite score
- Entropy debt tracking: cumulative ledger — excess above 0.6 accumulates, bleeds off 0.05/turn (0.15 during grounded responses), 3-turn rolling avg >0.2 triggers heightened sensitivity
- Emotion keywords expanded: 37 → 59 (added sadness, anxiety, surprise, dismissal, deep gratitude)

**Round 2 — Intensity scaling:**
- All categories switched from boolean to count-based: `Math.min(baseScore + hitCount * increment, cap)`
- Emotions: base 0.15, +0.10/hit, cap 0.50 | Corrections: base 0.15, +0.07/hit, cap 0.40
- 73 emotion keywords total

**Round 3 — Stem matching:**
- Emotion keywords converted to stems at init, matched via regex
- "frustration" now matches "frustrated"/"frustrating" etc.

**Round 4 — Telegram envelope stripping:**
- `_stripContextBlocks` didn't know about Telegram metadata envelope (~300 chars of JSON with message_id, sender, etc.)
- Envelope was being fed into embedding model alongside actual message, diluting scores
- Fix: dedicated regex strips Telegram metadata blocks and audio transcript headers before scoring

**Round 5 — Semantic emotion scoring (Plutchik wheel):**
- Replaced keyword emotion block with nomic-embed semantic scoring (localhost:8082)
- 8 primary emotions × 3 intensity levels = 24 Plutchik anchors, 109 phrase embeddings (768-dim, ~650KB)
- Runtime: one HTTP call to nomic-embed (~5ms), cosine similarity against all phrase embeddings
- No LLM calls, no tokens, no cost
- Catches what keywords missed: "useless waste of time" → 0.24, "holy shit that actually worked" → 0.29

**Round 6 — Valence gate:**
- Embeddings detect intensity but not direction ("oh my god frustrating" → joy because arousal matches)
- Pure JS valence gate: curated negative/positive word lists determine message polarity
- If anchor valence conflicts with detected message valence, reroutes to best anchor of correct valence family
- "frustrating make me cringe": joy_medium → anger_medium 0.317
- "I am super frustrated": anger_low → anger_medium 0.454

### Config changes
- `config.default.json`: metaConceptWarningThreshold 10→3, emotion patterns expanded (73 keywords as fallback), debt config added, correction/paradox/metacognitive patterns expanded
- Ring buffer: 5 → 50 entries (entropy-history.json)
- OMA dashboard still reads from ring buffer (not entropy-monitor.jsonl) — known gap

### Results (real user messages)
| Message | Before | After |
|---------|--------|-------|
| "I'm super frustrated" | 0.00 | 0.325 |
| "This is fucking amazing!" | 0.00 | 0.471 |
| "This is sooo unacceptable" | 0.00 | 0.515 |
| "Man this frustrating" | 0.00 | 0.534 |
| "yes please" | 0.00 | 0.045 |
| "Approved. Go ahead." | 0.00 | 0.011 |

### Known limitations
- Sarcasm not detected (embeddings can't catch "So I need to curb my sarcasm")
- Indirect frustration weak ("this better be not another bad experience" → 0.049)
- Negation patterns missed ("not fun" → low score)
- Dashboard reads 50-entry ring buffer, not full entropy-monitor.jsonl

### Files changed
- `~/.openclaw/extensions/openclaw-plugin-stability/lib/entropy.js` — async scoring, Shannon, debt, intensity scaling, stems, semantic embeddings, valence gate
- `~/.openclaw/extensions/openclaw-plugin-stability/index.js` — async agent_end, Telegram envelope stripping
- `~/.openclaw/extensions/openclaw-plugin-stability/config.default.json` — expanded patterns, debt config, threshold adjustments
- `~/.openclaw/extensions/openclaw-plugin-stability/data/emotion-anchors.json` — 24 Plutchik anchors with phrases and weights (~6.7KB)
- `~/.openclaw/extensions/openclaw-plugin-stability/data/emotion-embeddings.json` — 109 phrase embeddings, 768-dim (~650KB)

### Architecture insight from research paper
CoderOfTheWest's growth-vector-systems-paper.md (Feb 2026) acknowledges keyword matching is the weakest link. Clint has 9-source entropy decomposition but same keyword foundation. Paper notes model-internal entropy (logit distributions) would be better than text-based pattern matching. Our semantic scoring via local embeddings is a step beyond upstream that stays within the text-based paradigm but uses actual semantic similarity instead of string matching.

## Roadmap

### Near-term
1. **LCM secrets scrubbing** — Tool I/O stored verbatim in lcm.db. Need scrubbing layer before storage. CRITICAL prerequisite for production confidence.
2. **Crystallization plugin (Task #92)** — Growth vector → permanent trait pipeline. Blocked on contemplation proving first successful passes.
3. **Hebbian decay (Task #93)** — Schema columns exist, logic is stub. Wire real decay + search ranking.

> ✅ **Done:** `prependContext → prependSystemContext` — both continuity and stability already migrated.

### Mid-term
5. **Growth vector quality (Task #102)** — Behavioral vs operational separation. Metabolism pipeline v2 redesign.
6. **Metabolism on lcm.db** — Session-end extraction against full lossless record instead of compacted snippets.
7. **Cross-session LCM queries** — `allConversations: true` for searching across every session.

### Vision
8. **Unified knowledge architecture** — LCM DAG as conversation record + knowledge graph. Growth vectors as DAG annotations. Facts as DAG-derived entities. One store, multiple views.

## AGENTS.md Integration (updated 2026-03-05)
- Added `### Recalled Memories` section per upstream continuity design
- Four rules: don't deny recalled knowledge, first-person voice, newer wins on conflicts, facts.db = your knowledge
- Separates behavioral instructions (AGENTS.md) from curated memory (MEMORY.md)
