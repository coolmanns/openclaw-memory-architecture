# OpenClaw Metacognitive Plugin Suite — Code Review
**Date**: 2026-03-07  
**Reviewer**: Gandalf (subagent, plugin-code-review session)  
**Scope**: Architecture analysis, code quality, data flow, pipeline health  
**Context**: Sascha reports inconsistent agent behavior — instructions followed sometimes, ignored other times.

---

## Executive Summary

The core learning loop is **partially broken**. Metabolism is running and processing conversations correctly, producing growth vector candidates and facts.db entries. But the growth vectors are **never injected into agent context** — 655 candidates sit in `growth-vectors.json` with 0 validated entries, because the promotion pathway doesn't exist at runtime. Contemplation has 4 inquiries stuck in `in_progress` with no passes completed. Crystallization is not installed. The graph context plugin exists but isn't loaded.

**The inconsistent behavior Sascha experiences is not caused by the plugin architecture injecting wrong data.** The plugins that do inject context (continuity + stability) appear sound. The inconsistency is more likely model-level execution variance, possibly compounded by continuity surfacing stale or tangentially relevant past exchanges. However, the broken learning loop means the system is not improving over time — nothing the agent learns is being fed back into future conversations.

---

## Per-Plugin Findings

### 1. `openclaw-plugin-stability`

**Status**: ✅ Healthy  
**Data**: Entropy nominal at 0.30, 15 feedback entries, entropy history active.

**Core logic**: Sound. Multi-agent scoped via `AgentState` class. Hook chain is correct: `before_agent_start` (priority 5) injects stability context, `agent_end` calculates entropy and runs detectors, `after_tool_call` handles loop detection, `before_compaction` flushes state.

**Growth vector injection**: ⚠️ **Silently doing nothing.** The `loadVectors()` method filters to `validation_status === 'validated' || 'integrated'` only. The growth-vectors.json file has 655 candidates and 0 validated vectors. The stability plugin has a `runLifecycle()` call on startup that could prune old candidates but cannot promote them — promotion only happens via `addCandidate()` when recurrence hits 3, but the metabolism cron writes directly to the JSON file and bypasses this method entirely.

**Net effect**: Growth vector injection block in `before_agent_start` resolves to an empty array every turn. The `state.vectorStore.getRelevantVectors()` call succeeds but returns nothing. No `[GROWTH VECTORS]` block is ever injected into context.

**Config assessment**: Running defaults — no custom configuration in `openclaw.json`. This is fine; defaults are reasonable. The `filePath: null` config means it resolves to `~/clawd/memory/growth-vectors.json`, which is correct.

**Bugs/issues found**:
- `_extractLastUserMessage()` applies `_stripContextBlocks()` which strips context via timestamp regex as fallback. The timestamp format `[Sat 2026-03-07 12:32 CST]` matches the regex `\[(?:Mon|Tue|...)` — this may occasionally strip the actual user message if it's a subagent context header. Low risk but worth noting.
- `api.stability` property is set on the plugin's scoped `api` object. Contemplation's `agent_end` hook calls `api.stability?.getEntropy(ctx.agentId)` — this works because contemplation's hook fires in the same gateway process where the stability plugin set `api.stability`. However, this is fragile: it depends on plugin load order and the specific scoping behavior of the gateway's SDK. Metabolism correctly avoids this by parsing the stability header from conversation text instead.

---

### 2. `openclaw-plugin-continuity`

**Status**: ✅ Healthy with caveats  
**Data**: Archives being written, SQLite-vec indexer active, FactsSearcher initialized.

**Core logic**: Sound. Per-agent scoping correct. Topic tracking, anchor detection, and context budgeting all functioning. The `before_agent_start` hook at priority 10 (after stability at 5) injects the `[CONTINUITY CONTEXT]` block.

**RRF fusion**: The `Searcher` class performs 3-way RRF fusion (semantic + keyword + graph). The `_getGraphResults()` call looks for graph plugin data via a global/shared mechanism — but the original `openclaw-plugin-graph` is retired and `graph-memory` is installed but not loaded. So the graph arm of RRF is always empty. The 2-way fusion (semantic + keyword) is still better than either alone, but the graph boost is missing.

**Facts.db integration**: `FactsSearcher` reads from facts.db and applies Hebbian activation scoring. This IS working — metabolism is inserting facts and they're being retrieved. This is the most reliable memory pathway in the system right now.

**Per-agent feature flags**: Working correctly. `spiritual-dude` has `facts: false, files: false, continuity: true` — this is the per-agent flag feature from the recent implementation task.

**Config assessment**: Mostly defaults. The `agents.spiritual-dude` feature flag config is the only customization, and it's correct.

**Stale data risk**: ⚠️ Continuity archives past conversations with no TTL. The semantic search may surface exchanges from months ago with equal weight to recent ones (temporal decay is applied but only at scoring time, not at index-pruning). A 6-month-old "I prefer X" can override a recent correction "actually I prefer Y" if the embedding similarity is similar but the session date is further back. The temporal decay in RRF scoring should handle this, but it depends on the decay factor tuning.

**Duplicate detection**: The archiver uses hash deduplication for exact duplicates. However, continuity search can return near-duplicate exchanges from different sessions, cluttering the context block with highly similar retrieved memories.

---

### 3. `openclaw-plugin-metabolism`

**Status**: ✅ Working, with architecture gaps  
**Data**: 2,956 processed candidates, 4 pending. Cron running every 5 minutes. Facts.db being populated.

**Core logic**: The fast path (hook) and slow path (cron) are both functional. The entropy parsing from the stability header is a pragmatic workaround for the cross-plugin API limitation, but it works.

**Config mismatch — `entropyMinimum`**: The `openclaw.json` sets `entropyMinimum: 0.7`, but the cron script has its own config object that doesn't specify a threshold, defaulting to `0.6`. This means the gateway plugin (in-process) uses 0.7 but the cron uses 0.6. Sessions with entropy between 0.6–0.7 will queue candidates via the cron but would be skipped by the gateway hook. Not a critical bug — the cron is the primary processor — but the config split is a maintenance hazard.

**Dead config keys**: `heartbeatInterval: 1` in `openclaw.json` is a dead config key. The heartbeat hook was removed (noted in the code: "Removed dead heartbeat hook on 2026-03-05"). The metabolism `batch_size: 10` in `openclaw.json` affects only the gateway method `metabolism.trigger`, not the cron. The cron hardcodes `BATCH_SIZE = 10`.

**Gap forwarding is broken for the cron path**: The metabolism → contemplation pipeline requires `global.__ocMetabolism.gapListeners` to be populated. This only works in-process (gateway). The cron runs as a separate Node.js process — `global.__ocMetabolism` doesn't exist there, and the cron doesn't forward gaps at all. The cron collects gaps from `processOne()` results but silently discards them:

```js
// Cron: gaps are returned by processOne() but never used
const result = await processor.processOne(c);
// result.gaps exists but cron only reads result.growthVectors
allGrowthVectors.push(...result.growthVectors); 
// ^ gaps discarded here
```

This means the high-quality LLM-derived gaps that should feed contemplation are **never forwarded**. Contemplation only receives gaps from its own `agent_end` hook (regex-based extraction from raw conversation), which is lower quality and lower volume.

**Growth vector candidate format**: The cron writes growth vector candidates directly to `growth-vectors.json` with `source: 'metabolism'`. The stability plugin's `addCandidate()` method (which handles auto-promotion at recurrence >= 3) is never called for these. Candidates sit unprocessed forever unless the crystallization plugin (not installed) or manual `stability.validateVector` gateway call promotes them.

**LLM backend change**: The cron was updated 2026-03-07 to use `claude-sonnet-4-20250514` via Anthropic API. The metabolism plugin config in `openclaw.json` still points to `llm.endpoint: http://127.0.0.1:8084` (llama.cpp Qwen3). There's a split: the gateway-triggered path uses llama.cpp, the cron uses Claude Sonnet. Practical effect: cron processing is higher quality (Claude vs Qwen3-30B), but the config is inconsistent and could confuse future debugging.

---

### 4. `openclaw-plugin-contemplation`

**Status**: ⚠️ Operational but stalled  
**Data**: 4 inquiries, all `in_progress`, 0 passes completed, 0 insights generated.

**Core logic**: Sound design. Inquiry → 3-pass reflection pipeline (0h, 4h, 20h delays). Nightshift integration via `global.__ocNightshift.queueTask`. The metabolism gap subscription via `global.__ocMetabolism.gapListeners` is in place.

**Why no passes have run**: The nightshift plugin controls when passes run. Nightshift only processes during configured office hours (23:00–08:00 CST). The nightshift state shows `officeHoursActive: false` and `processedTonight: {}`. Pass 1 for all 4 inquiries has `scheduled` = inquiry creation time (≥ 9 hours ago) but `completed = None`.

This points to one of two issues:
1. The nightshift heartbeat hasn't fired during off-hours since these inquiries were created, OR
2. The contemplation task runner isn't registered with nightshift's runner registry.

The contemplation plugin registers its runner with `global.__ocNightshift.registerTaskRunner('contemplation', ...)`. Nightshift plugin exposes `global.__ocNightshift.registerTaskRunner`. This should work — **but only if contemplation loads AFTER nightshift**, because `global.__ocNightshift` must exist when contemplation's `register()` runs. The plugin load order in `openclaw.json` shows contemplation before nightshift in the `load.paths` array:

```json
"paths": [
    ".../openclaw-plugin-stability",
    ".../openclaw-plugin-continuity",
    ".../openclaw-plugin-metabolism",
    ".../openclaw-plugin-contemplation",  // ← BEFORE nightshift
    ".../openclaw-plugin-compliance",
    ".../openclaw-plugin-nightshift"      // ← AFTER contemplation
]
```

**This is the likely root cause**: If plugins register in load order, contemplation's `register()` runs before nightshift sets up `global.__ocNightshift`. The `registerTaskRunner` call in contemplation would silently fail (the conditional `if (global.__ocNightshift?.registerTaskRunner)` returns undefined, so contemplation's runner is never registered). Nightshift then has no runner for `contemplation` type tasks.

The heartbeat fallback in contemplation (`if (global.__ocNightshift?.queueTask) return;`) would also fail silently — `global.__ocNightshift` exists by heartbeat time, so it skips the fallback, and nightshift runs the task but finds no registered runner.

**Gap quality**: The 4 inquiries include:
- "What are Martin Ball's current Patreon subscriber numbers?" — factual/external, unanswerable by reflection
- "How does batch_size=10 interact with llama.cpp --parallel 2 under sustained load?" — valid technical question
- "How do you handle schema evolution with Apache AGE?" — valid technical question
- A duplicate of Martin Ball + batch_size question in one inquiry — the extractor concatenated two questions into one

The Martin Ball Patreon question appearing twice (as separate inquiries from different exchanges) suggests the extractor isn't deduplicating across sessions. The duplicate inquiry from `inq_gutjyjpq` is particularly bad — it's a concatenation: `"What are Martin Ball's current Patreon subscriber numbers?" or "How does batch_size=10 interact..."` — the extractor extracted the full ambiguous content as a single gap.

**LLM config mismatch**: The `openclaw.json` contemplation config sets `endpoint: "http://127.0.0.1:8084"` (Qwen3 local). The `config.default.json` now shows `endpoint: "https://api.anthropic.com/v1/messages"` with `format: "anthropic"`. If the default.json was updated after `openclaw.json` was written, the deep merge gives user config priority — so contemplation still uses Qwen3 locally for passes. This is fine and intentional.

---

### 5. `openclaw-plugin-crystallization`

**Status**: ❌ Not installed

Not present in `~/.openclaw/extensions/`. Referenced in:
- Nightshift config (`crystallization: { enabled: false, priority: 25, maxPerNight: 2 }`)
- Contemplation code comments (`gaps → inquiries → nightshift passes → crystallization → growth vectors`)
- Multiple metabolism debug files discussing its design

The design intent is clear from the debug data: crystallization consumes growth vectors after 30 days, applies a principle alignment gate, and requires human approval before making behaviors permanent. This is the missing final step that would promote candidate growth vectors to validated status, enabling stability injection.

**Without crystallization, the full loop is**: metabolism writes candidates → candidates accumulate forever → stability reads 0 validated vectors → nothing learned is ever injected back.

The nightshift config has crystallization disabled (`enabled: false`) — this is intentional per the metabolism debug files which recommend "waiting for 10–20 promoted growth vectors before installing crystallization."

---

### 6. `openclaw-plugin-graph` (retired) / `graph-memory` (installed, not loaded)

**Status**: ❌ Graph context not active

The original `openclaw-plugin-graph` is retired to `_retired-openclaw-plugin-graph/`. Its replacement `graph-memory` is installed at `~/.openclaw/extensions/graph-memory/` but is NOT in the `plugins.load.paths` or `plugins.entries` in `openclaw.json`.

The `graph-memory` plugin uses `facts.db` via a Python subprocess (`graph-search.py`) with Hebbian scoring and co-occurrence learning. This is a simpler approach than the retired plugin's multi-hop Neo4j-style graph traversal.

The continuity `Searcher` still calls `_getGraphResults()` and attempts 3-way RRF fusion. Without the graph plugin loaded, `_getGraphResults()` returns an empty array. RRF degrades to 2-way (semantic + keyword) — still functional but not leveraging the graph context.

---

## Pipeline Analysis: Is the Full Loop Working?

```
User conversation
       │
       ▼
agent_end hook (stability)
  ├── Calculate entropy ✅
  └── Feed to metabolism (via header parsing) ✅

agent_end hook (metabolism) 
  ├── Queue candidate if entropy ≥ 0.7 ✅
  └── [gap forwarding to contemplation: ❌ broken — cron path only]

metabolism-cron.js (every 5 min)
  ├── Process candidates via Claude Sonnet ✅
  ├── Write growth vectors to candidates[] ✅
  ├── Insert facts into facts.db ✅
  └── Forward gaps to contemplation: ❌ NEVER (cron discards gaps)

agent_end hook (contemplation)
  ├── Extract gaps via regex ⚠️ (low quality, some duplicates)
  └── Queue inquiries ✅

nightshift heartbeat (23:00–08:00 CST)
  ├── Find contemplation task runner: ❌ NOT REGISTERED (load order bug)
  └── Run pass: ❌ NEVER (no runner)

stability before_agent_start
  ├── Load validated growth vectors: ❌ 0 validated (655 candidates)
  └── Inject [GROWTH VECTORS]: ❌ NEVER (nothing to inject)

crystallization (not installed)
  └── Promote candidates → validated: ❌ MISSING PLUGIN
```

**Working portions of the loop**:
- Entropy monitoring → stable ✅
- Loop detection → stable ✅
- Continuity (semantic + keyword + facts.db) → stable ✅
- Metabolism candidate queuing → stable ✅
- Metabolism cron processing → stable ✅
- Facts.db population → stable ✅
- Contemplation gap extraction (low-quality path) → marginal ⚠️

**Broken portions**:
1. Metabolism gaps → contemplation (cron path broken, only raw extraction works)
2. Contemplation passes (load-order bug, nightshift runner not registered)
3. Growth vector promotion (no crystallization, no auto-promotion for metabolism candidates)
4. Growth vector injection into context (0 validated, nothing to inject)
5. Graph context (graph-memory not loaded)

---

## Stale Data / Memory Invalidation Assessment

**No invalidation mechanism exists for any layer.** This is a significant design gap.

| Layer | Data Type | Expiry | Risk |
|-------|-----------|--------|------|
| growth-vectors.json candidates | 655 entries | 30-day prune on startup only | LOW (all <3 days old) |
| growth-vectors.json vectors | 0 entries | Max 100, oldest removed | N/A |
| facts.db | ~100s of facts | NONE | **MEDIUM** |
| Continuity archives | Conversation history | NONE | **MEDIUM** |
| Contemplation inquiries | 4 inquiries | NONE | LOW (few entries) |

**Facts.db staleness**: Metabolism inserts facts on every cron run. The processor has a `no_change` skip rule (seen in logs: "Skipped 1 facts (no_change)"), which prevents identical values from being re-inserted. However, if a fact changes (e.g., "Gandalf uses model X" → "Gandalf uses model Y"), the new value is inserted as a new fact but the old one isn't deleted. The FactsSearcher then retrieves both, and the agent receives contradictory context. The Hebbian activation scoring should gradually deprioritize older/less-retrieved facts, but it doesn't explicitly invalidate them.

**Continuity archive staleness**: Past conversations are archived and indexed permanently. A conversation from 6 weeks ago where Sascha said "I prefer to keep the blog posts short" would still be retrieved and injected alongside newer conversations where the preference changed. Temporal decay in RRF scoring reduces its weight, but doesn't eliminate it.

**This is the most likely cause of inconsistent behavior**: The agent sometimes receives older continuity context that contradicts current preferences, because the retrieval model doesn't have a "latest-wins" semantic. This is a retrieval architecture issue, not a code bug.

---

## Recommendations (Ranked by Impact)

### P0 — Fix the contemplation load order bug

**Impact**: High. This is blocking all contemplation passes from ever running.

The `openclaw-plugin-contemplation` must load AFTER `openclaw-plugin-nightshift` so that `global.__ocNightshift` is available when contemplation's `register()` runs.

Fix in `openclaw.json`: swap the positions of contemplation and nightshift in `plugins.load.paths`:
```json
"paths": [
    ".../openclaw-plugin-stability",
    ".../openclaw-plugin-continuity",
    ".../openclaw-plugin-metabolism",
    ".../openclaw-plugin-compliance",
    ".../openclaw-plugin-nightshift",     // ← nightshift FIRST
    ".../openclaw-plugin-contemplation"   // ← contemplation AFTER
]
```

Also swap in `plugins.entries` if order matters there.

Verification: After restart, check `openclaw gateway logs` for `[Contemplation] Registered nightshift task runner for "contemplation"` during startup. Then wait for off-hours and check if pass 1 completes.

### P1 — Forward gaps from the metabolism cron to contemplation

**Impact**: High. The cron is the primary metabolism path. Its gaps never reach contemplation.

The cron runs in a separate process so `global.__ocMetabolism` is unavailable. Two options:

**Option A** (file-based, simple): Cron writes extracted gaps to a JSON file (`~/.openclaw/extensions/openclaw-plugin-contemplation/data/pending-gaps.json`). Contemplation polls this file on heartbeat or session_end and ingests it.

**Option B** (gateway call, cleaner): Cron calls a gateway method `contemplation.queueGap` via HTTP. Add the method to the contemplation plugin. Cron already has a similar pattern (Uptime Kuma push).

Option A is faster to implement and doesn't require a new gateway endpoint.

### P2 — Load the `graph-memory` plugin

**Impact**: Medium. Adds a third RRF arm to continuity search, surfacing facts.db entity relationships.

Add to `plugins.load.paths` and `plugins.entries`:
```json
"/home/coolmann/.openclaw/extensions/graph-memory"
```

The plugin is already installed, just not loaded. Requires verifying `graph-search.py` is functional and `facts.db` is where the plugin expects it.

### P3 — Implement a growth vector auto-promotion mechanism

**Impact**: Medium. The crystallization plugin is a full plugin to build. A simpler bridge is:

Add a cron or gateway method that promotes metabolism candidates with:
- Age > 24h (has had time to be reviewed)
- Source = 'metabolism' (already LLM-processed, higher quality)
- Set `validation_status = 'validated'`

This bypasses crystallization's full 30-day approval flow but gets useful context injecting while crystallization is being developed. Cap at 20 promoted vectors initially.

### P4 — Add facts.db invalidation

**Impact**: Medium-High for consistency. Lower urgency since activation scoring degrades stale facts over time.

The metabolism processor should check for existing facts with the same subject/predicate. If the new value differs, mark the old fact as superseded (add a `superseded_by` field or simply delete the old row). Continuity's FactsSearcher should filter out superseded facts.

This directly addresses the "agent sometimes knows outdated facts" case.

### P5 — Add a "latest wins" retrieval mode to continuity

**Impact**: Medium. When the same topic appears in multiple archived exchanges with conflicting facts, prefer the newest.

The RRF fusion currently applies temporal decay but doesn't de-rank explicitly contradictory content. A contradiction detector (similar to the stability plugin's detectors) could flag retrieved exchanges where one contradicts another and inject only the newest.

### P6 — Fix the cron/gateway config split for metabolism

**Impact**: Low. Maintenance hygiene.

The cron `entropyMinimum` (0.6 implicit) differs from `openclaw.json` (0.7 explicit). Make the cron read from a shared config or set the default to match.

### P7 — Deduplicate contemplation inquiries

**Impact**: Low. Only 4 inquiries currently, but will worsen.

The `InquiryStore.addInquiry()` should check for question similarity before adding. A simple approach: normalize questions to lowercase, strip punctuation, check if the new question's words overlap > 70% with an existing open inquiry.

---

## Blog Post Outline Potential

The architecture here has two genuinely interesting angles for the OpenClaw community blog:

### Post 1: "The Metabolism Loop — Building a Self-Improving AI Agent" 
*The hardest problem in agentic AI isn't intelligence, it's retention*

- The design: conversation → implications → growth vectors → context injection
- Why it's hard: decoupled fast/slow paths, cross-plugin communication, validation gates
- What we built: metabolism + contemplation + nightshift + crystallization (4-plugin pipeline)
- Current state: what's working, what's still being built
- Lessons: the load-order bug as a metaphor for async systems, the "655 candidates and 0 validated" moment

**Why it's interesting**: Most agents forget everything. We built a system that learns. The architecture itself — fast path / slow path, LLM-extracted implications, 3-pass reflection — is genuinely novel and shareable.

### Post 2: "Memory and Consistency — Why AI Agents Give You Different Answers Each Time"
*The inconsistency problem isn't the model. It's the retrieval.*

- What inconsistency actually looks like in practice (following instructions sometimes, not others)
- The memory stack: which layers contribute what
- The stale data problem: why "no TTL" is a subtle footgun
- Hebbian activation as a partial solution
- What we're doing about it: facts.db invalidation, latest-wins retrieval, temporal decay

**Why it's interesting**: Sascha's experience of inconsistency is universal among people running AI agents. This post would name the actual problem (retrieval architecture, not model intelligence) and explain the solution space.

---

## Appendix: Plugin Load Order (Actual)

```
1. openclaw-plugin-stability      (priority 5  in before_agent_start)
2. openclaw-plugin-continuity     (priority 10 in before_agent_start)
3. openclaw-plugin-metabolism     (no before_agent_start hook)
4. openclaw-plugin-contemplation  (no before_agent_start hook)
5. openclaw-plugin-compliance     (before tool calls)
6. openclaw-plugin-nightshift     (heartbeat)
```

`graph-memory` is installed but not in this list.

## Appendix: Data Volume Summary

| Store | Count | Notes |
|-------|-------|-------|
| Metabolism candidates (pending) | 4 | All from today |
| Metabolism processed | 2,956 | Running since ~2026-03-05 |
| Growth vector candidates | 655 | 0 validated, all from metabolism |
| Growth vector validated | 0 | **Nothing is ever injected** |
| Contemplation inquiries | 4 | All in_progress, 0 passes completed |
| Continuity vector store | Unknown | SQLite-vec, not inspected |
| facts.db | Unknown row count | Populated by metabolism, read by continuity |
| Entropy observations | 2956+ | entropy-monitor.jsonl |
| Growth vector feedback entries | 15 | Feedback loop tracking |
