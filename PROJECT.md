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
| **Writer** | Metabolism via `insert-facts.js` — every 30 min, Qwen3-30B-A3B, 10 guardrails |
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
| Metabolism | CoderofTheWest | coolmanns/openclaw-plugin-metabolism | GAPS extraction, gap forwarding, entity normalization, metadata stripping, guardrails |
| Stability | CoderofTheWest | (no fork — using upstream) | — |
| Contemplation | CoderofTheWest | (no fork — using upstream) | — |
| Graph | CoderofTheWest | (no fork — installed untracked) | — |

README install instructions point to our forks for continuity + metabolism, upstream for stability + contemplation.

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

Together they form a complete metacognitive loop: observe behavior → extract knowledge → crystallize identity → enhance recall. We run 4/7 (stability, continuity, metabolism, contemplation). Graph installed but untracked. Nightshift skipped (heartbeat + cron). Crystallization next (Task #92, after contemplation proven).

**Pipeline status (2026-03-06 evening):** Metabolism → GAPS extraction → gapListeners → Contemplation inquiry queue → heartbeat passes. First end-to-end test successful (6 gaps from 3 candidates). Awaiting first completed contemplation pass cycle (~24h).

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
- LLM endpoint: `localhost:8084/v1/chat/completions` (Qwen3-30B, shared with metabolism)
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
- Metabolism cron: `*/5` → `*/30` (less llama.cpp contention)
- llama-metabolism: `-c 8192`, `--parallel 2`, `--reasoning-format none`
- `--reasoning-format none` required for Qwen3 models (fixes `<think>` tag crash)

See: `docs/adr/002-contemplation-implementation.md`

## AGENTS.md Integration (updated 2026-03-05)
- Added `### Recalled Memories` section per upstream continuity design
- Four rules: don't deny recalled knowledge, first-person voice, newer wins on conflicts, facts.db = your knowledge
- Separates behavioral instructions (AGENTS.md) from curated memory (MEMORY.md)
