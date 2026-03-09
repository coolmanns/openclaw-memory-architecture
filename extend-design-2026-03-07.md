# Metacognitive Learning Loop — Implementation Design
**Date**: 2026-03-07  
**Author**: Gandalf (extend-design subagent)  
**Status**: Ready for implementation  
**Scope**: 4 targeted fixes — config swap, gap queue, auto-promotion, facts invalidation  
**References**: `extend-audit-2026-03-07.md`, `plugin-code-review-2026-03-07.md`

---

## Fix 1: Swap Contemplation/Nightshift Load Order

**Effort**: 5 minutes | **Risk**: LOW

### Problem
Contemplation loads at index 3, nightshift at index 5. Contemplation's `register()` checks `global.__ocNightshift?.registerTaskRunner` — undefined at that point. Task runner never registers. All contemplation passes silently never execute.

### Files to Modify
| File | Change |
|------|--------|
| `~/.openclaw/openclaw.json` | Swap indices in `plugins.load.paths` and `plugins.allow` |

### What Changes
**`plugins.load.paths`** — move nightshift before contemplation:
```json
"paths": [
    "/home/coolmann/.openclaw/extensions/openclaw-plugin-stability",        // 0 — unchanged
    "/home/coolmann/.openclaw/extensions/openclaw-plugin-continuity",       // 1 — unchanged
    "/home/coolmann/.openclaw/extensions/openclaw-plugin-metabolism",       // 2 — unchanged
    "/home/coolmann/.openclaw/extensions/openclaw-plugin-nightshift",      // 3 — was index 5
    "/home/coolmann/.openclaw/extensions/openclaw-plugin-compliance",       // 4 — unchanged
    "/home/coolmann/.openclaw/extensions/openclaw-plugin-contemplation"    // 5 — was index 3
]
```

**`plugins.allow`** — swap `"contemplation"` (currently index 9) and `"nightshift"` (currently index 10):
```json
"allow": [
    "telegram", "discord", "openclaw-plugin-stability", "openclaw-plugin-continuity",
    "openclaw-plugin-metabolism", "skill-resolver", "openclaw-plugin-compliance",
    "lobster", "open-prose",
    "nightshift",      // was index 10
    "contemplation"    // was index 9
]
```

### What Stays the Same
- All plugin code — zero code changes
- All other plugin positions in load order
- Plugin entry configurations (the `"contemplation": { ... }` and `"nightshift": { ... }` config blocks stay where they are — only `paths` and `allow` arrays change)
- Metabolism loads before both (index 2), so `global.__ocMetabolism.gapListeners` is still set when contemplation registers its gap listener

### Regression Risks
| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Plugin that depends on contemplation loading before nightshift | None found in audit | Check startup logs for new ERRORs |
| Allow list order affects behavior | Unlikely (order is for humans) | Verify both plugins show in `openclaw status` |

### Regression Check
After restart, run: `journalctl --user -u openclaw-gateway --since "5 min ago" | grep -i contemplation`
- **MUST see**: `[Contemplation] Registered nightshift task runner for "contemplation"`
- **MUST NOT see**: Any new ERROR or WARN lines

### Verification Steps
1. Follow GP-004 protocol (backup, edit, validate JSON, schema validate, restart)
2. Grep gateway logs for the registration message above
3. Wait for nightshift hours (23:00 CST) — check if contemplation passes start completing
4. After first night: verify `~/.openclaw/extensions/openclaw-plugin-contemplation/data/agents/main/inquiries.json` shows `pass[0].completed` timestamps

### Rollback
Restore `~/.openclaw/openclaw.json` from the GP-004 backup (`openclaw.json.bak-HHMM`), restart gateway.

---

## Fix 2: Wire Metabolism Cron Gaps to Contemplation via File Queue

**Effort**: 30 minutes | **Risk**: LOW

### Problem
`metabolism-cron.js` runs as standalone Node.js process. `processOne()` returns `result.gaps` but the cron only collects `result.growthVectors`. Gaps are silently discarded. The in-process `global.__ocMetabolism.gapListeners` mechanism doesn't work in the cron (separate process, no globals).

### Files to Modify
| File | Change |
|------|--------|
| `/home/coolmann/clawd/scripts/metabolism-cron.js` | Collect gaps, write to queue file |
| `~/.openclaw/extensions/openclaw-plugin-contemplation/index.js` | Add `ingestFileQueue()`, call from heartbeat |

### Change 1: metabolism-cron.js — Collect and Write Gaps

**Add** `allGaps` array alongside `allGrowthVectors` (after line ~43):
```js
const allGrowthVectors = [];
const allGaps = [];  // NEW
```

**Add** gap collection inside the `for (const c of candidates)` loop, after growth vector collection (~line 56):
```js
// Collect gaps for contemplation queue
if (result.gaps && result.gaps.length > 0) {
    allGaps.push(...result.gaps.map(g => ({
        question: typeof g === 'string' ? g : g.question || g.text || String(g),
        sourceId: c.id,
        source: `metabolism:${c.id}`,
        timestamp: new Date().toISOString()
    })));
}
```

**Add** queue file write after the growth vectors write block (~after line 92):
```js
// Write gaps to contemplation file queue
if (allGaps.length > 0) {
    const GAPS_QUEUE_PATH = path.join(
        process.env.HOME,
        '.openclaw/extensions/openclaw-plugin-contemplation/data/pending-gaps.json'
    );
    try {
        let existing = [];
        if (fs.existsSync(GAPS_QUEUE_PATH)) {
            try { existing = JSON.parse(fs.readFileSync(GAPS_QUEUE_PATH, 'utf8')); } catch { existing = []; }
        }
        existing.push(...allGaps);
        // Cap at 50 to prevent unbounded growth
        if (existing.length > 50) existing = existing.slice(-50);
        const tmpPath = GAPS_QUEUE_PATH + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(existing, null, 2));
        fs.renameSync(tmpPath, GAPS_QUEUE_PATH);
        console.log(`[metabolism-cron] Queued ${allGaps.length} gap(s) for contemplation`);
    } catch (e) {
        console.error(`[metabolism-cron] Gap queue write error: ${e.message}`);
    }
}
```

**Key decisions**:
- Atomic write via tmp + rename (prevents partial reads)
- Cap at 50 entries (prevents runaway growth if contemplation is down)
- Append to existing queue (cron runs every 5 min, contemplation reads on heartbeat — may accumulate)

### Change 2: contemplation/index.js — Ingest File Queue

**Add** new function (before the heartbeat handler, around line 85):
```js
function ingestFileQueue(state, logger) {
    const queuePath = path.join(__dirname, 'data', 'pending-gaps.json');
    if (!fs.existsSync(queuePath)) return 0;

    let gaps;
    try {
        const raw = fs.readFileSync(queuePath, 'utf8');
        gaps = JSON.parse(raw);
        if (!Array.isArray(gaps) || gaps.length === 0) return 0;
        // Truncate immediately — atomic window is two sync calls
        fs.writeFileSync(queuePath, '[]');
    } catch (e) {
        if (logger) logger.warn(`[Contemplation] Gap queue read error: ${e.message}`);
        return 0;
    }

    // Discard gaps older than 1 hour (stale after downtime)
    const maxAge = 60 * 60 * 1000;
    const now = Date.now();
    let ingested = 0;

    for (const gap of gaps) {
        if (gap.timestamp && (now - new Date(gap.timestamp).getTime()) > maxAge) continue;
        state.store.addInquiry({
            question: gap.question,
            source: gap.source || 'metabolism:cron',
            entropy: 0,
            context: gap.question
        });
        ingested++;
    }

    if (ingested > 0 && logger) {
        logger.info(`[Contemplation] Ingested ${ingested} gap(s) from file queue`);
    }
    return ingested;
}
```

**Hook** into the existing heartbeat handler (add at the top of the heartbeat callback):
```js
// In the heartbeat handler, add as first line:
ingestFileQueue(getState(ctx.agentId), api.logger);
```

### What Stays the Same
- The in-process `gapListeners` mechanism (still works for gateway-triggered metabolism)
- All existing contemplation inquiry logic
- The cron's growth vector writing (untouched)
- Gap format from `processOne()` (we normalize on the cron side)

### Regression Risks
| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Race between cron write and contemplation read | Very low (sync fs ops, 5-min interval) | Atomic tmp+rename on write side |
| Queue grows unbounded | Low | 50-entry cap on write, 1-hour staleness filter on read |
| Bad gap format crashes contemplation | Low | try/catch around parse, type coercion for gap.question |
| Contemplation `addInquiry` signature changes | Low | It's our code, we control it |

### Regression Check
- After deploying, manually create a test gap file:
  ```bash
  echo '[{"question":"test gap from cron","source":"test","sourceId":"test","timestamp":"'$(date -u +%FT%TZ)'"}]' > ~/.openclaw/extensions/openclaw-plugin-contemplation/data/pending-gaps.json
  ```
- Wait for next heartbeat, then check:
  ```bash
  cat ~/.openclaw/extensions/openclaw-plugin-contemplation/data/agents/main/inquiries.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('inquiries',[])))"
  ```
- Count should increase by 1, and `pending-gaps.json` should be `[]`

### Verification Steps
1. Deploy both file changes
2. Restart gateway (for contemplation change)
3. Wait for metabolism cron run (5 min) — check cron output for `Queued N gap(s)`
4. Wait for heartbeat — check gateway logs for `Ingested N gap(s) from file queue`
5. Check inquiries store for new entries with `source: "metabolism:cand_*"`

### Rollback
- **Cron**: Revert `metabolism-cron.js` — gaps just stop being collected (no side effects)
- **Contemplation**: Remove `ingestFileQueue` function and heartbeat call — contemplation falls back to regex-only gap extraction (current behavior)
- **Queue file**: Delete `pending-gaps.json` — it's purely additive

---

## Fix 3: Auto-Promote Growth Vector Candidates

**Effort**: 20 minutes | **Risk**: MEDIUM

### Problem
655 growth vector candidates sit in `growth-vectors.json` `candidates[]` with 0 validated. Metabolism cron writes directly via `candidates.push()`, bypassing `VectorStore.addCandidate()` auto-promotion. Stability's `loadVectors()` filters to `validation_status === 'validated'` — finds nothing. The `[GROWTH VECTORS]` block is never injected.

### Design Decision: Cron Sweep (Option B from audit)

**Why not Option A (use VectorStore.addCandidate)**: The `addCandidate()` similarity check uses Jaccard word-overlap (0.7 threshold). Metabolism vectors often have similar phrasing — risk of false merges and premature promotion of low-quality vectors. Option B gives explicit control.

**Why cron sweep**: Runs in the same cron as metabolism processing. No new process. Conservative gates (age + recurrence). Easy to tune thresholds.

### Files to Modify
| File | Change |
|------|--------|
| `/home/coolmann/clawd/scripts/metabolism-cron.js` | Add promotion sweep after growth vector write |

### The Change

**Add** after the growth vectors write block (after ~line 92), before the status push:

```js
// === Auto-promote mature growth vector candidates ===
const MAX_VALIDATED = 20;  // Cap validated vectors to prevent context bloat
const MIN_AGE_MS = 24 * 60 * 60 * 1000;  // 24 hours minimum age
const MIN_RECURRENCE = 2;  // Must have appeared at least twice

try {
    let data = { vectors: [], candidates: [] };
    if (fs.existsSync(GROWTH_VECTORS_PATH)) {
        try { data = JSON.parse(fs.readFileSync(GROWTH_VECTORS_PATH, 'utf8')); } catch {}
    }
    data.vectors = data.vectors || [];
    data.candidates = data.candidates || [];

    const currentValidated = data.vectors.filter(
        v => v.validation_status === 'validated' || v.validation_status === 'integrated'
    ).length;

    if (currentValidated >= MAX_VALIDATED) {
        console.log(`[metabolism-cron] Skipping promotion: ${currentValidated} validated vectors (cap: ${MAX_VALIDATED})`);
    } else {
        const now = Date.now();
        const budget = MAX_VALIDATED - currentValidated;
        const promoted = [];

        // Sort by recurrence (highest first) for quality-first promotion
        const sortedCandidates = [...data.candidates]
            .filter(c => c.timestamp && (now - new Date(c.timestamp).getTime()) >= MIN_AGE_MS)
            .filter(c => (c.recurrence || 0) >= MIN_RECURRENCE)
            .sort((a, b) => (b.recurrence || 0) - (a.recurrence || 0));

        for (const c of sortedCandidates) {
            if (promoted.length >= budget) break;

            c.validation_status = 'validated';
            c.validation_note = `Auto-promoted by cron: age ${Math.round((now - new Date(c.timestamp).getTime()) / 3600000)}h, recurrence ${c.recurrence}`;
            c.promoted_at = new Date().toISOString();
            data.vectors.push(c);
            promoted.push(c.id || c.pattern || '(unnamed)');
        }

        if (promoted.length > 0) {
            // Remove promoted from candidates
            const promotedSet = new Set(promoted);
            data.candidates = data.candidates.filter(c => !promotedSet.has(c.id || c.pattern || '(unnamed)'));

            fs.writeFileSync(GROWTH_VECTORS_PATH, JSON.stringify(data, null, 2));
            console.log(`[metabolism-cron] Promoted ${promoted.length} growth vector(s): ${promoted.join(', ')}`);
        }
    }
} catch (e) {
    console.error(`[metabolism-cron] Promotion sweep error: ${e.message}`);
}
```

### What Stays the Same
- Existing growth vector write logic (candidates still written normally)
- `VectorStore.loadVectors()` filter (already correct — returns `validated` + `integrated`)
- `VectorStore.addCandidate()` (unused by cron, stays for in-process use)
- Stability injection logic in `before_agent_start` (already queries `loadVectors()` + scores relevance)
- The 655 existing candidates (left in place — natural promotion by age + recurrence, or 30-day prune)

### What's New (that affects existing behavior)
⚠️ **This is the first time growth vectors will appear in agent context.** Once promoted, stability's `before_agent_start` hook will inject a `[GROWTH VECTORS]` block with scored vectors. This is the *intended* behavior, but it hasn't been running — so the agent will start receiving new context it never had before.

**Mitigation**: The 20-vector cap limits exposure. Stability's relevance scoring (`getRelevantVectors`) already filters to contextually relevant vectors per-conversation. The injection is additive (appended to `[STABILITY CONTEXT]` block), not replacing anything.

### Regression Risks
| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Low-quality vectors promoted | Medium | Recurrence ≥ 2 gate (repeated = more likely valuable). Age ≥ 24h gate. Monitor first 10 promotions. |
| Context injection changes agent behavior | Expected — that's the goal | Cap at 20. Stability relevance scoring. Log every promotion. |
| Over-promotion floods context | Low | 20-vector hard cap. Stability injects top-N by relevance, not all. |
| Candidate ID collision in promotedSet | Low | Using `id || pattern || '(unnamed)'` — metabolism assigns unique IDs |

### Regression Check
After first promotion:
```bash
# Check what got promoted
cat ~/clawd/memory/growth-vectors.json | python3 -c "
import json, sys
d = json.load(sys.stdin)
validated = [v for v in d.get('vectors',[]) if v.get('validation_status') == 'validated']
print(f'Validated: {len(validated)}')
for v in validated[:5]:
    print(f'  - {v.get(\"pattern\",\"?\")[:80]} (recurrence: {v.get(\"recurrence\",0)})')
"
```

Check that stability actually injects them — after next conversation, grep logs:
```bash
journalctl --user -u openclaw-gateway --since "10 min ago" | grep -i "growth vector"
```

### Verification Steps
1. Deploy the cron change
2. Wait for cron run (~5 min)
3. Check cron output: should show `Promoted N growth vector(s)` or `Skipping promotion: N validated vectors`
4. After promotion, start a conversation — stability should inject `[GROWTH VECTORS]` block
5. Spot-check promoted vectors for quality (are they actually useful behavioral patterns?)

### Rollback
Remove the promotion sweep block from `metabolism-cron.js`. Manually reset promoted vectors if needed:
```bash
python3 -c "
import json
d = json.load(open('$HOME/clawd/memory/growth-vectors.json'))
for v in d.get('vectors', []):
    if v.get('validation_note','').startswith('Auto-promoted'):
        d['candidates'].append(v)
        v['validation_status'] = 'candidate'
d['vectors'] = [v for v in d['vectors'] if not v.get('validation_note','').startswith('Auto-promoted')]
json.dump(d, open('$HOME/clawd/memory/growth-vectors.json','w'), indent=2)
print('Rollback complete')
"
```

---

## Fix 4: facts.db Invalidation for Superseded Facts

**Effort**: 45 minutes | **Risk**: MEDIUM

### Problem
When metabolism inserts a fact with same entity+key but different value, it correctly upserts (updates the value). But:
1. If key names differ slightly (`model` vs `llm_model`), both coexist — agent receives contradictory context
2. No way to query "what changed" for debugging stale fact issues
3. The upsert works fine for same-key updates, but there's no mechanism for semantic key aliasing

### Design Decision: `superseded_at` Column + Query-Time Filter

**Why not delete old facts**: Deleting loses audit trail. Changelog exists but isn't queryable by continuity.

**Why `superseded_at` over a separate invalidation table**: Simpler. One column, one filter. No joins.

**Scope limitation (YAGNI)**: We do NOT build automatic semantic key aliasing in this fix. That requires NLP/LLM in the upsert path — too complex, too risky. Instead: (1) add the column, (2) filter at query time, (3) add a manual `supersede` function for operators, (4) strengthen the LLM prompt for key consistency.

### Files to Modify
| File | Change |
|------|--------|
| `~/.openclaw/extensions/openclaw-plugin-metabolism/lib/insert-facts.js` | Add column migration, set `superseded_at` on upsert |
| `~/.openclaw/extensions/openclaw-plugin-continuity/storage/facts-searcher.js` | Filter `WHERE superseded_at IS NULL` in all queries |

### Change 1: insert-facts.js — Schema Migration + Upsert Update

**Add** after the `CREATE TABLE IF NOT EXISTS facts_changelog` block (~line 210):
```js
// Ensure superseded_at column exists (idempotent migration)
try {
    db.exec('ALTER TABLE facts ADD COLUMN superseded_at TEXT DEFAULT NULL');
} catch { /* Column already exists — expected */ }
try {
    db.exec('ALTER TABLE facts ADD COLUMN superseded_by TEXT DEFAULT NULL');
} catch { /* Column already exists — expected */ }
```

**Modify** the upsert logic (Guardrail 12, ~line 296). Current code:
```js
if (existing) {
    stmtUpdate.run(value, category, source, entity, key);
    stmtChangelog.run(entity, key, 'update', existing.value, value, source);
    updated++;
}
```

**Replace** the `stmtUpdate` prepared statement definition (~line 225):
```js
const stmtUpdate = db.prepare(`
    UPDATE facts SET value = ?, category = ?, source = ?, last_accessed = datetime('now'),
    superseded_at = NULL, superseded_by = NULL
    WHERE entity = ? AND key = ?
`);
```

Note: setting `superseded_at = NULL` on update ensures that if a fact was manually superseded and then re-emerges, it un-supersedes. This is intentional — the latest upsert wins.

### Change 2: facts-searcher.js — Query-Time Filter

**Modify** all `SELECT ... FROM facts` queries to add `AND superseded_at IS NULL` (or `WHERE superseded_at IS NULL` for queries without existing WHERE).

Specific lines to modify in `~/.openclaw/extensions/openclaw-plugin-continuity/storage/facts-searcher.js`:

| Line | Current | New |
|------|---------|-----|
| 134 | `SELECT COUNT(*) as c FROM facts` | `SELECT COUNT(*) as c FROM facts WHERE superseded_at IS NULL` |
| 247 | `SELECT COUNT(*) as c FROM facts` | `SELECT COUNT(*) as c FROM facts WHERE superseded_at IS NULL` |
| 248 | `...WHERE permanent = 1` | `...WHERE permanent = 1 AND superseded_at IS NULL` |
| 375-377 | FTS match query | Add post-filter (FTS doesn't support extra WHERE — filter results in JS) |
| 383 | `...WHERE entity = ? AND key = ?` | `...WHERE entity = ? AND key = ? AND superseded_at IS NULL` |
| 423 | `...WHERE entity = ? AND key LIKE ?` | `...WHERE entity = ? AND key LIKE ? AND superseded_at IS NULL` |
| 426 | `...WHERE entity = ?` | `...WHERE entity = ? AND superseded_at IS NULL` |

**FTS special case** (line 375-377): The `facts_fts` virtual table doesn't have the `superseded_at` column. The query returns `f.rowid, f.entity, f.key, f.value`. After the FTS query returns results, add a post-filter:
```js
// After FTS results are collected:
const activeRowIds = results.map(r => r.rowid);
if (activeRowIds.length > 0) {
    const superseded = new Set(
        db.prepare(`SELECT rowid FROM facts WHERE rowid IN (${activeRowIds.map(() => '?').join(',')}) AND superseded_at IS NOT NULL`)
          .all(...activeRowIds)
          .map(r => r.rowid)
    );
    results = results.filter(r => !superseded.has(r.rowid));
}
```

### Change 3: Strengthen LLM Prompt for Key Consistency

**In** `~/.openclaw/extensions/openclaw-plugin-metabolism/lib/processor.js`, find the `_buildPrompt()` method's PREFERRED KEYS section. Add:

```
CRITICAL: Before choosing a key name, check the KNOWN ENTITIES section. If the entity already has a fact with a similar key, use the EXACT same key name. For example:
- If entity "Gandalf" already has key "model", use "model" — NOT "llm_model", "backend_model", "ai_model"
- If entity "Sascha" already has key "location", use "location" — NOT "city", "home_city", "residence"
Reusing existing keys triggers an update instead of creating a duplicate.
```

### What Stays the Same
- All existing facts remain accessible (no data migration, no deletions)
- The upsert flow (same entity+key → update value) — unchanged, works correctly
- Changelog logging — unchanged
- Hebbian activation scoring — unchanged
- FTS indexing — unchanged

### What's New (that affects existing behavior)
⚠️ **Stats queries will change**: `SELECT COUNT(*)` now excludes superseded facts. If any monitoring depends on total fact count, it will see a lower number after facts are superseded. Currently no monitoring watches this — but note it.

⚠️ **The `superseded_at` column is initially NULL for all rows** — so all existing facts pass the filter. No immediate behavior change. Only future upserts or manual supersession will activate this.

### Regression Risks
| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| ALTER TABLE fails on locked DB | Very low (SQLite WAL mode) | Run during quiet period; `try/catch` makes it idempotent |
| Facts disappear unexpectedly | Low | `superseded_at` is NULL by default — only set on upsert (which already replaces the value) |
| FTS post-filter performance | Low | Extra query, but facts.db is small (<10K rows) |
| Continuity breaks on missing column | Low | The `AND superseded_at IS NULL` filter works even before the metabolism migration runs — SQLite returns empty for unknown columns in WHERE only if the column truly doesn't exist, but ALTER TABLE is idempotent and runs on first metabolism cron |

### Regression Check
After deploying:
```bash
# Verify column exists
sqlite3 ~/.openclaw/extensions/openclaw-plugin-metabolism/data/facts.db "PRAGMA table_info(facts)" | grep superseded

# Verify all facts are still visible (superseded_at is NULL for all)
sqlite3 ~/.openclaw/extensions/openclaw-plugin-metabolism/data/facts.db "SELECT COUNT(*) FROM facts WHERE superseded_at IS NOT NULL"
# Expected: 0

# Test that continuity still returns facts
# (start a conversation, check [CONTINUITY CONTEXT] includes facts)
```

### ⚠️ Important: Which facts.db?
There are THREE facts.db files:
- `~/.openclaw/data/facts.db` — gateway core
- `~/.openclaw/extensions/openclaw-plugin-metabolism/data/facts.db` — metabolism's copy
- `~/.openclaw/extensions/openclaw-plugin-continuity/data/facts.db` — continuity's copy

**Determine which one continuity's FactsSearcher actually reads** before deploying. The ALTER TABLE must run on the same DB that FactsSearcher queries. Check `facts-searcher.js` constructor for the DB path.

### Verification Steps
1. Deploy insert-facts.js changes
2. Run metabolism cron — verify no errors, ALTER TABLE runs silently
3. Manually test upsert: insert a fact, then insert same entity+key with different value
4. Verify old value is in `facts_changelog`, new value is in `facts`
5. Deploy facts-searcher.js changes
6. Restart gateway
7. Start a conversation — verify `[CONTINUITY CONTEXT]` still shows facts
8. Supersede a test fact manually, verify it stops appearing

### Rollback
- **insert-facts.js**: Revert the file. The `superseded_at` column stays in the schema (harmless — all values are NULL, no queries use it without the facts-searcher change)
- **facts-searcher.js**: Revert the file, restart gateway. All facts visible again including any that were superseded
- **Column**: Leave it. Empty columns cost nothing. Removing requires a full table rebuild in SQLite.

---

## Implementation Order

```
Fix 1 (config swap)     →  Fix 3 (auto-promote)     →  Fix 2 (gap queue)     →  Fix 4 (facts invalidation)
     5 min                      20 min                      30 min                      45 min
     LOW risk                   MEDIUM risk                 LOW risk                    MEDIUM risk
     Unblocks contemplation     Enables injection path      New feature, additive       Schema change
```

**Why this order**:
1. Fix 1 first — config-only, unblocks contemplation passes, validates nightshift integration
2. Fix 3 second — enables the injection pathway so we can verify the full loop works
3. Fix 2 third — additive feature, no existing code modified, enriches contemplation input
4. Fix 4 last — schema change needs careful migration, least urgent (Hebbian decay partially compensates)

**Total estimated effort**: ~1.5 hours of implementation + testing

---

## Full Loop After All 4 Fixes

```
Conversation
    │
    ▼
agent_end → metabolism queues candidate ✅ (unchanged)
    │
    ▼
metabolism-cron (every 5 min)
    ├── Process via Claude Sonnet ✅ (unchanged)
    ├── Write growth vectors to candidates[] ✅ (unchanged)
    ├── Insert/upsert facts into facts.db ✅ (Fix 4: with superseded_at)
    ├── Write gaps to pending-gaps.json 🆕 (Fix 2)
    └── Promote mature candidates to validated 🆕 (Fix 3)
         │
         ▼
    contemplation heartbeat
    ├── Ingest gaps from file queue 🆕 (Fix 2)
    └── Create inquiries from gaps ✅ (unchanged)
         │
         ▼
    nightshift (23:00-08:00)
    └── Run contemplation passes ✅ (Fix 1: now actually registered)
         │
         ▼
    stability before_agent_start
    ├── Load validated growth vectors ✅ (Fix 3: now has vectors to load)
    └── Inject [GROWTH VECTORS] block ✅ (unchanged code, new data)
         │
         ▼
    Better conversations → more metabolism input → learning loop closes ✅
```

---

## Open Questions for Implementer

1. **Which facts.db does continuity read?** Three copies exist. The ALTER TABLE and FactsSearcher filter must target the same DB. Check `facts-searcher.js` constructor.

2. **Existing 655 candidates**: The design intentionally does NOT retroactively promote them all. Most are <3 days old and won't meet the 24h age gate yet. They'll promote naturally over the next few days, capped at 20. Is this acceptable, or does Sascha want a one-time bulk promotion of the best ones?

3. **Contemplation LLM endpoint**: Currently `http://127.0.0.1:8084` (local Qwen3). After Fix 1, passes will actually run — using Qwen3. Is this intentional, or should contemplation use Anthropic API for higher-quality reflection passes?

4. **Growth vector quality gate**: The current design uses recurrence ≥ 2 + age ≥ 24h. Should we add an entropy threshold (only promote candidates from sessions with entropy ≥ 0.5)? The audit recommends this but it requires the candidate to store source entropy, which metabolism already does.
