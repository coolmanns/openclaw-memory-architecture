# Metacognitive Plugin Suite — Extension Audit
**Date**: 2026-03-07  
**Auditor**: Gandalf (subagent, extend-audit session)  
**Scope**: 4 targeted fixes for the broken metacognitive learning loop  
**Reference**: `plugin-code-review-2026-03-07.md` (prior comprehensive review)

---

## Current State

### The Broken Loop

The metacognitive learning loop is designed as:

```
Conversation → Metabolism (implications/gaps/facts) → Contemplation (3-pass reflection) 
→ Growth Vectors (validated) → Stability (context injection) → Better conversations
```

**What works**: Metabolism processes candidates via cron (Claude Sonnet), extracts implications, inserts facts into facts.db, generates growth vector candidates. Stability monitors entropy and would inject growth vectors if any were validated.

**What's broken (the 4 issues this audit addresses)**:

1. **Contemplation loads before nightshift** → `global.__ocNightshift` doesn't exist when contemplation registers its task runner → passes never execute
2. **Metabolism cron gaps are silently discarded** → the cron runs in a separate process where `global.__ocMetabolism.gapListeners` is empty → high-quality LLM-derived gaps never reach contemplation
3. **655 growth vector candidates sit with 0 validated** → metabolism writes directly to `growth-vectors.json` `candidates[]`, bypassing `VectorStore.addCandidate()` auto-promotion logic → stability's `loadVectors()` filters to `validation_status === 'validated'` and finds nothing
4. **facts.db has no supersession mechanism** → when a fact changes (e.g. "X uses model Y" → "X uses model Z"), both values coexist → agent receives contradictory context

---

## Extension Points

### Fix 1: Swap contemplation/nightshift load order

**File**: `~/.openclaw/openclaw.json`  
**Section**: `plugins.load.paths` (array, index 3 and 5)

**Current order** (broken):
```json
"paths": [
    ".../openclaw-plugin-stability",        // 0
    ".../openclaw-plugin-continuity",       // 1
    ".../openclaw-plugin-metabolism",        // 2
    ".../openclaw-plugin-contemplation",    // 3  ← registers runner here
    ".../openclaw-plugin-compliance",       // 4
    ".../openclaw-plugin-nightshift"        // 5  ← global.__ocNightshift set here
]
```

**Required order** (fixed):
```json
"paths": [
    ".../openclaw-plugin-stability",        // 0
    ".../openclaw-plugin-continuity",       // 1
    ".../openclaw-plugin-metabolism",        // 2
    ".../openclaw-plugin-nightshift",       // 3  ← sets global.__ocNightshift FIRST
    ".../openclaw-plugin-compliance",       // 4
    ".../openclaw-plugin-contemplation"     // 5  ← now finds global.__ocNightshift
]
```

**Also update**: `plugins.allow` array — currently has `contemplation` at index 9 and `nightshift` at index 10. Swap to `nightshift` before `contemplation`. (Allow list order may not affect load order, but consistency matters for humans reading the config.)

**Extension point in contemplation** (`contemplation/index.js:120-126`):
```js
if (global.__ocNightshift?.registerTaskRunner) {
    global.__ocNightshift.registerTaskRunner('contemplation', async (task, ctx) => {
        const state = getState(ctx.agentId);
        await runOneDuePass(state, ctx);
    });
    api.logger.info('[Contemplation] Registered nightshift task runner for "contemplation"');
}
```
This conditional silently succeeds (no-op) when `global.__ocNightshift` is undefined. After the swap, it will find the global and register.

**Also check**: The metabolism gap listener registration at `contemplation/index.js:97-115` depends on `global.__ocMetabolism.gapListeners` which IS set by metabolism (loaded at index 2), so metabolism→contemplation order is already correct.

**Verification**: After restart, grep gateway logs for `Registered nightshift task runner for "contemplation"`. If missing, the fix didn't work.

---

### Fix 2: Wire metabolism cron gaps to contemplation via file-based queue

**Problem**: `scripts/metabolism-cron.js` runs as standalone Node.js process. The `processOne()` call returns `result.gaps` but the cron only reads `result.growthVectors` and discards gaps.

**Cron file**: `/home/coolmann/clawd/scripts/metabolism-cron.js`  
**Extension point** (line ~42, after the `for (const c of candidates)` loop):

```js
// CURRENT CODE (line ~50-53):
if (result.growthVectors && result.growthVectors.length > 0) {
    allGrowthVectors.push(...result.growthVectors);
}

// ADD: collect gaps too
// if (result.gaps && result.gaps.length > 0) {
//     allGaps.push(...result.gaps);
// }
```

**New code location** (after growth vectors write, ~line 68):  
Write collected gaps to a file-based queue that contemplation reads.

**Queue file path**: `~/.openclaw/extensions/openclaw-plugin-contemplation/data/pending-gaps.json`

**Format** (append-safe JSON array):
```json
[
    {
        "question": "How does batch_size=10 interact with...",
        "source": "metabolism:cand_1772463750915_bsj91nd61",
        "sourceId": "cand_1772463750915_bsj91nd61",
        "timestamp": "2026-03-07T18:30:00.000Z"
    }
]
```

**Contemplation ingestion point**: `contemplation/index.js`  
Add a new function (after `runOneDuePass`, ~line 85):

```js
function ingestFileQueue(state) {
    const queuePath = path.join(__dirname, 'data', 'pending-gaps.json');
    if (!fs.existsSync(queuePath)) return 0;
    
    let gaps;
    try {
        gaps = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
        // Immediately truncate to prevent re-ingestion
        fs.writeFileSync(queuePath, '[]');
    } catch { return 0; }
    
    let count = 0;
    for (const gap of gaps) {
        state.store.addInquiry({
            question: gap.question,
            source: `metabolism:${gap.sourceId || 'cron'}`,
            entropy: 0,
            context: gap.question
        });
        count++;
    }
    return count;
}
```

**Hook it into**: The `heartbeat` handler (contemplation/index.js ~line 153) and/or `before_agent_start`. The heartbeat handler already exists and fires regularly — add `ingestFileQueue(state)` at the top.

**Race condition risk**: The cron writes and contemplation reads the same file. Mitigation: contemplation reads + truncates atomically (write empty array immediately after read). Since both operations are synchronous fs operations and the cron runs at most every 5 minutes, the race window is negligible. For extra safety, use a rename-based approach: cron writes to `pending-gaps.tmp.json`, then renames to `pending-gaps.json`.

---

### Fix 3: Auto-promote growth vector candidates for stability injection

**Problem**: Metabolism cron writes candidates directly to `growth-vectors.json` `candidates[]` array, bypassing `VectorStore.addCandidate()` which has auto-promotion logic at recurrence >= 3. The `loadVectors()` method only returns vectors with `validation_status === 'validated' || 'integrated'`.

**There are TWO possible extension points:**

#### Option A: Fix the cron to use VectorStore.addCandidate() (preferred)

**File**: `/home/coolmann/clawd/scripts/metabolism-cron.js` (line ~60-68)

**Current code**:
```js
existing.candidates.push(...allGrowthVectors);
fs.writeFileSync(GROWTH_VECTORS_PATH, JSON.stringify(existing, null, 2));
```

**Replace with**: Instantiate VectorStore and use `addCandidate()`:
```js
const VectorStore = require(STABILITY_PLUGIN_DIR + '/lib/vectorStore');
const vectorStore = new VectorStore(
    { growthVectors: { candidatePromotionThreshold: 3 } },
    null,
    process.env.HOME + '/clawd'
);
for (const gv of allGrowthVectors) {
    vectorStore.addCandidate(gv);
}
```

This routes through the existing auto-promotion logic in `VectorStore.addCandidate()` (vectorStore.js line ~200-230):
```js
// Auto-promote if recurrence >= 3
if (existing.recurrence >= (this.config.candidatePromotionThreshold || 3)) {
    existing.validation_status = 'validated';
    existing.validation_note = `Auto-promoted after ${existing.recurrence} recurrences`;
    data.vectors.push(existing);
    data.candidates = data.candidates.filter(c => c.id !== existing.id);
}
```

**Risk**: The `addCandidate()` similarity check (`this._similarity() > 0.7`) uses word-overlap Jaccard. Metabolism growth vectors often have similar phrasing (e.g., multiple "The user prefers..." vectors). This could cause over-aggressive deduplication and premature promotion. Monitor the first 10 promotions for quality.

#### Option B: Add a promotion sweep to the cron (simpler, less risky)

Add to the metabolism cron, after writing growth vectors:

```js
// Auto-promote candidates older than 24h with recurrence >= 2
const data = JSON.parse(fs.readFileSync(GROWTH_VECTORS_PATH, 'utf8'));
const cutoff = Date.now() - 24 * 60 * 60 * 1000;
const promoted = [];
data.candidates = (data.candidates || []).filter(c => {
    if (new Date(c.timestamp).getTime() < cutoff && (c.recurrence || 0) >= 2) {
        c.validation_status = 'validated';
        c.validation_note = 'Auto-promoted by cron (age + recurrence)';
        data.vectors = data.vectors || [];
        data.vectors.push(c);
        promoted.push(c.id);
        return false; // remove from candidates
    }
    return true;
});
if (promoted.length > 0) {
    fs.writeFileSync(GROWTH_VECTORS_PATH, JSON.stringify(data, null, 2));
    console.log(`[metabolism-cron] Promoted ${promoted.length} growth vector(s)`);
}
```

**Cap recommendation**: Add a max validated vectors check (e.g., 20 initially) to prevent flooding the stability injection.

**VectorStore.loadVectors() filter** (vectorStore.js line ~88-91):
```js
loadVectors() {
    const data = this.loadFile();
    return data.vectors.filter(v =>
        v.validation_status === 'validated' || v.validation_status === 'integrated'
    );
}
```
This is correct — no changes needed here. Once candidates are promoted to `validated`, they'll be picked up.

**Stability injection point** (stability/index.js, `before_agent_start` hook, ~line after `const scoredResults = state.vectorStore.getRelevantVectors(...)`):
Already correctly implemented — it calls `loadVectors()`, scores relevance, and injects the top results as `[GROWTH VECTORS]` block. This will "just work" once there are validated vectors.

---

### Fix 4: facts.db invalidation for superseded facts

**Problem**: When metabolism inserts a fact with an existing entity+key but different value, it updates the value (upsert). However, the changelog shows the old value but doesn't mark it as superseded. More critically, if metabolism extracts facts with slightly different key names for the same concept (e.g., `model` vs `llm_model`), both coexist.

**Primary extension point**: `~/.openclaw/extensions/openclaw-plugin-metabolism/lib/insert-facts.js`

**Current upsert logic** (insert-facts.js, line ~155-170):
```js
if (existing) {
    stmtUpdate.run(value, category, source, entity, key);
    stmtChangelog.run(entity, key, 'update', existing.value, value, source);
    updated++;
} else {
    stmtInsert.run(entity, key, value, category, source, isPermanent, importance);
    stmtChangelog.run(entity, key, 'insert', null, value, source);
    inserted++;
}
```

**This already handles same entity+key updates correctly.** The upsert replaces the old value. The real problem is:

1. **Key aliasing**: The same concept gets different keys (`model` vs `llm_model` vs `backend_model`). The processor's LLM prompt asks for "PREFERRED KEYS" but doesn't enforce them strictly.

2. **Temporal context lost**: When a fact is updated, the old value is logged in `facts_changelog` but continuity's FactsSearcher doesn't consult the changelog.

**Recommended extension — add a `superseded_at` column**:

```sql
ALTER TABLE facts ADD COLUMN superseded_at TEXT DEFAULT NULL;
ALTER TABLE facts ADD COLUMN superseded_by INTEGER DEFAULT NULL;
```

**Modify the upsert logic** to set `superseded_at` on the old row when creating a replacement (for cases where the key name differs but the semantic meaning is the same).

**Simpler approach — add key normalization to the processor prompt**:

In `processor.js` `_buildPrompt()` (line ~270), the PREFERRED KEYS section already exists. Strengthen it:

```
IMPORTANT: For each entity, check if a fact with a similar key already exists in KNOWN ENTITIES.
If the entity already has a "model" fact, use "model" — not "llm_model", "backend_model", etc.
```

**Continuity FactsSearcher extension point**: The FactsSearcher in `~/.openclaw/extensions/openclaw-plugin-continuity/` should filter out facts where `superseded_at IS NOT NULL` (if the column is added). Need to locate the exact query.

**Practical MVP**: Add `superseded_at` column + modify `insertFacts()` to set it when updating. Add a cleanup cron or lifecycle method that marks facts with low `decay_score` and `access_count = 0` (never retrieved) as superseded after 30 days.

---

## Dependencies

### Cross-Plugin Communication Map

```
                    global.__ocMetabolism.gapListeners
Metabolism ─────────────────────────────────────────────► Contemplation
  (index.js:82)      (array of callbacks)                  (index.js:97)
                                                           
                    global.__ocNightshift                   
Nightshift ─────────────────────────────────────────────► Contemplation
  (index.js:228)     (registerTaskRunner, queueTask)       (index.js:120)
                                                           
                    [STABILITY CONTEXT] header              
Stability ──────────────────────────────────────────────► Metabolism
  (before_agent_start)  (parsed from user message text)    (agent_end, regex)
                                                           
                    growth-vectors.json (filesystem)        
Metabolism cron ────────────────────────────────────────► Stability
  (metabolism-cron.js)  (candidates[] array)                (VectorStore.loadFile)
                                                           
                    facts.db (SQLite)                       
Metabolism ─────────────────────────────────────────────► Continuity
  (insert-facts.js)    (FactsSearcher reads)               (FactsSearcher)
                                                           
                    api.stability.getEntropy()             
Stability ──────────────────────────────────────────────► Contemplation
  (index.js:397)       (scoped api property)               (agent_end, optional)
```

### Load Order Dependencies (CRITICAL)

| Plugin | Depends On | Must Load After |
|--------|-----------|-----------------|
| Stability | None | — |
| Continuity | None (reads facts.db independently) | — |
| Metabolism | Stability (header parsing, not load-order dependent) | — |
| **Nightshift** | None | — |
| **Contemplation** | **global.__ocNightshift** (runtime global) | **Nightshift** |
| **Contemplation** | **global.__ocMetabolism** (runtime global) | **Metabolism** |
| Compliance | None | — |

### File-Based Dependencies

| File | Writer | Reader |
|------|--------|--------|
| `~/clawd/memory/growth-vectors.json` | Metabolism cron, VectorStore | Stability VectorStore |
| `~/.openclaw/data/facts.db` | Metabolism insert-facts.js | Continuity FactsSearcher |
| `contemplation/data/agents/*/inquiries.json` | Contemplation InquiryStore | Contemplation InquiryStore |
| `nightshift/data/state.json` | Nightshift AgentState | Nightshift AgentState |
| **NEW**: `contemplation/data/pending-gaps.json` | Metabolism cron (Fix 2) | Contemplation (Fix 2) |

---

## Existing Tests

### Metabolism Plugin Tests
**File**: `~/.openclaw/extensions/openclaw-plugin-metabolism/test.js`  
**Run**: `cd ~/.openclaw/extensions/openclaw-plugin-metabolism && node test.js`  
**Result**: ✅ 9/9 passed, 0 failed, 0 skipped  
**Coverage**: CandidateStore (write, get, process, prune), Processor (format, parse, classify), integration (growth vector write). The LLM test uses live Anthropic API.

### Contemplation Plugin Tests
**File**: `~/.openclaw/extensions/openclaw-plugin-contemplation/test/test.js`  
**Run**: `cd ~/.openclaw/extensions/openclaw-plugin-contemplation && node test/test.js`  
**Result**: ⚠️ 1/2 passed, 1 failed  

**Failing test**: `extractor emits gaps for keyword hit`  
**Root cause**: Test message is "I am curious how this pattern works over time." but the extractor's GAP_PATTERNS regex uses `/I'm curious/` (with contraction). The keyword check `['curious']` bypasses the entropy threshold, but the actual gap extraction regex doesn't match "I am curious" (only "I'm curious"). The extractor's `extractGapsFromText()` finds no matches, returns empty array. **This is a pre-existing bug in the extractor regex, not related to the 4 fixes.**

### Stability Plugin Tests
**File**: None found. No test files in the stability plugin directory.

### Nightshift Plugin Tests
**File**: None found. No test files in the nightshift plugin directory.

### Continuity Plugin Tests
**Files**: 11 test files in `~/.openclaw/extensions/openclaw-plugin-continuity/tests/`  
**Not run** (outside scope of this audit — these test continuity internals, not the metacognitive loop).

---

## Risk Areas

### Risk 1: Load Order Swap (Fix 1) — LOW RISK
**What could break**: If any plugin depends on contemplation being loaded before nightshift, the swap could break it. 
**Assessment**: No plugin depends on contemplation's globals. Contemplation only exports via `global.__ocMetabolism.gapListeners` (a push into metabolism's array, not a new global). Safe to swap.
**Mitigation**: Check gateway startup logs after restart for any new ERROR/WARN lines.

### Risk 2: File-Based Gap Queue (Fix 2) — LOW RISK
**What could break**: Race condition between cron write and contemplation read. Orphaned gaps if contemplation crashes mid-ingestion.
**Assessment**: The 5-minute cron interval makes races extremely unlikely. Contemplation's read+truncate is two synchronous fs calls with no yield point between them.
**Mitigation**: Use atomic rename (write to `.tmp`, rename to final). Add a max-age check (discard gaps older than 1 hour) to prevent stale ingestion after downtime.

### Risk 3: Growth Vector Auto-Promotion (Fix 3) — MEDIUM RISK
**What could break**: 
- **Over-promotion**: If similarity threshold (0.7 Jaccard) is too aggressive, dissimilar vectors get merged and promoted based on false recurrence counts.
- **Context injection bloat**: 655 candidates could promote many vectors at once, flooding the stability injection block.
- **Quality regression**: Metabolism-generated candidates are LLM-extracted from conversation. They vary in quality. Promoting low-quality vectors degrades agent behavior.
**Mitigation**: 
- Cap at 20 validated vectors initially
- Add a quality gate: only promote candidates with `entropy >= 0.5` at source
- Log all promotions for manual review in the first week
- Use Option B (cron sweep with age + recurrence gates) rather than Option A (VectorStore.addCandidate() which has the fragile similarity check)

### Risk 4: facts.db Invalidation (Fix 4) — MEDIUM RISK
**What could break**:
- **Schema migration**: Adding `superseded_at` column requires ALTER TABLE. If the migration runs while metabolism cron or continuity is reading facts.db, SQLite WAL mode should handle it, but there's a brief lock window.
- **Over-invalidation**: If the LLM generates slightly different key names for the same concept in successive runs, both get inserted as separate facts rather than triggering an update. Invalidation logic that's too aggressive could delete valid distinct facts.
**Mitigation**: 
- Run the ALTER TABLE during a quiet period (nightshift hours)
- Start with upsert-only invalidation (same entity+key, different value → update, no delete)
- Don't delete old facts — set `superseded_at` and filter at query time
- Monitor via `SELECT * FROM facts_changelog WHERE operation = 'update' ORDER BY timestamp DESC LIMIT 20`

### Risk 5: Nightshift/Contemplation Interaction After Fix — WATCH
**What could break**: Once contemplation passes actually run (Fix 1), they'll use the configured LLM endpoint. The `openclaw.json` contemplation config overrides the default and points to `http://127.0.0.1:8084` (local Qwen3). If that endpoint is down during nightshift hours, passes will fail silently (error caught, task retried up to 3 times, then dropped).
**Mitigation**: Verify Qwen3 availability during nightshift hours. Consider switching contemplation to Anthropic API (the `config.default.json` already has the Anthropic endpoint — removing the `openclaw.json` override would use it).

### Risk 6: The 4 Stalled Inquiries
After Fix 1, the 4 existing `in_progress` inquiries have `pass[0].scheduled` timestamps from hours ago. Once contemplation's nightshift runner activates, it will immediately process all 4 pass-1s (they're past due). This is fine — it's the intended catchup behavior. But it means 4 LLM calls in quick succession during the first nightshift cycle. The `maxPerNight: 3` config in nightshift will limit this to 3 per night.

---

## Recommendations

### Implementation Order

1. **Fix 1 first** (load order swap) — config-only change, immediate unblock, lowest risk
2. **Fix 3 second** (auto-promotion) — enables the injection pathway, moderate code change
3. **Fix 2 third** (gap queue) — new feature, additive code, no existing code modified
4. **Fix 4 last** (facts.db invalidation) — schema change, needs careful migration

### Fix 1: Config Swap
- Edit `~/.openclaw/openclaw.json`: swap contemplation and nightshift in both `plugins.load.paths` and `plugins.allow`
- Follow GP-004 protocol (backup, validate, restart)
- **Estimated effort**: 5 minutes

### Fix 2: Gap Queue
- Add gap collection to `scripts/metabolism-cron.js` (5 lines)
- Add gap file write after growth vectors write (15 lines)
- Add `ingestFileQueue()` function to `contemplation/index.js` (20 lines)
- Hook into heartbeat handler (2 lines)
- **Estimated effort**: 30 minutes

### Fix 3: Auto-Promotion
- Use Option B (cron sweep) for safety
- Add promotion sweep to `scripts/metabolism-cron.js` (20 lines)
- Add max validated vectors cap (5 lines)
- **Estimated effort**: 20 minutes
- **Note**: Don't try to retroactively promote the existing 655 candidates. Let the new logic promote future candidates naturally. The existing 655 will age out via VectorStore lifecycle (30-day prune).

### Fix 4: facts.db Invalidation
- Add `superseded_at` and `superseded_by` columns via ALTER TABLE in insert-facts.js schema section
- Modify upsert logic to set `superseded_at = datetime('now')` on old row when updating
- Modify FactsSearcher query to add `WHERE superseded_at IS NULL`
- Add key normalization hints to processor prompt
- **Estimated effort**: 45 minutes
- **Note**: Locate the FactsSearcher query in `~/.openclaw/extensions/openclaw-plugin-continuity/` — I didn't read that file in this audit. The implementer should grep for `SELECT.*FROM facts` in the continuity plugin.

### Pre-Existing Issues (Not in Scope but Worth Noting)
- Contemplation extractor test failure: `I am curious` vs `I'm curious` regex mismatch
- Contemplation LLM config points to local Qwen3 (`openclaw.json` override) while default.json has Anthropic — verify which is intended for pass execution
- No tests for stability or nightshift plugins
