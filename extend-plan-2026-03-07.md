# Metacognitive Learning Loop — Implementation Plan
**Date**: 2026-03-07  
**Author**: Gandalf (extend-plan subagent)  
**Status**: Ready for execution  
**Total Tasks**: 10  
**Estimated Time**: ~1.5 hours  
**References**: `extend-audit-2026-03-07.md`, `extend-design-2026-03-07.md`

---

## Decisions Incorporated

- **facts.db**: Single source at `~/.openclaw/data/facts.db` (both metabolism and continuity already point there — confirmed in code)
- **Contemplation LLM**: Switch from local Qwen3 (`http://127.0.0.1:8084`) to Anthropic Sonnet (remove endpoint override in openclaw.json)
- **Existing 655 candidates**: Natural promotion only (no bulk promotion)

## Implementation Order

```
Task 1-2: Config changes (load order swap + contemplation LLM switch)  ← 5 min
Task 3-4: Auto-promote growth vectors (Fix 3)                          ← 20 min
Task 5-7: Gap queue wiring (Fix 2)                                     ← 30 min  
Task 8-10: Facts invalidation (Fix 4)                                  ← 45 min
```

---

## Task 1: Swap Contemplation/Nightshift Load Order + Switch Contemplation LLM

**Files:** Modify `~/.openclaw/openclaw.json`  
**Pre-check:** `python3 -c "import json; json.load(open('/home/coolmann/.openclaw/openclaw.json')); print('JSON: valid')"`  
Expected: `JSON: valid`

**Step 1:** Back up config:
```bash
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak-$(date +%H%M)
```

**Step 2:** Edit `~/.openclaw/openclaw.json` — make THREE changes:

**Change A — `plugins.load.paths` array:** Swap indices 3 and 5. Current:
```json
"/home/coolmann/.openclaw/extensions/openclaw-plugin-contemplation",    // index 3
"/home/coolmann/.openclaw/extensions/openclaw-plugin-compliance",       // index 4
"/home/coolmann/.openclaw/extensions/openclaw-plugin-nightshift"        // index 5
```
New:
```json
"/home/coolmann/.openclaw/extensions/openclaw-plugin-nightshift",       // index 3
"/home/coolmann/.openclaw/extensions/openclaw-plugin-compliance",       // index 4
"/home/coolmann/.openclaw/extensions/openclaw-plugin-contemplation"     // index 5
```

**Change B — `plugins.allow` array:** Swap indices 9 and 10. Current:
```json
"contemplation",   // index 9
"nightshift"       // index 10
```
New:
```json
"nightshift",      // index 9
"contemplation"    // index 10
```

**Change C — `contemplation` plugin entry config:** Replace the `llm` block. Current:
```json
"contemplation": {
  "enabled": true,
  "config": {
    "llm": {
      "endpoint": "http://127.0.0.1:8084/v1/chat/completions",
      "model": "Qwen3-30B-A3B-Instruct-2507-UD-Q6_K_XL.gguf",
      "maxTokens": 1500,
      "temperature": 0.6,
      "timeoutMs": 60000
    },
```
New (remove `endpoint` and `model` — let the plugin use its default Anthropic endpoint, only keep behavioral overrides):
```json
"contemplation": {
  "enabled": true,
  "config": {
    "llm": {
      "maxTokens": 1500,
      "temperature": 0.6,
      "timeoutMs": 60000
    },
```

> **Why remove endpoint+model entirely?** The plugin's `index.js:51` defaults to `http://127.0.0.1:11434/v1/chat/completions` (Ollama) when no endpoint override exists. This is ALSO wrong — we need to verify what endpoint the `reflect.js` `callLLM()` function actually uses and whether it supports Anthropic's API format. See Task 2.

**Step 3:** Validate:
```bash
python3 -c "import json; json.load(open('/home/coolmann/.openclaw/openclaw.json')); print('JSON: valid')"
openclaw config validate
```
Expected: valid JSON, no schema errors.

**Step 4:** Commit:
```bash
cd ~/clawd && git add -A && git commit -m "fix(config): swap contemplation/nightshift load order, switch contemplation LLM to Anthropic"
```

**Regression check:** Do NOT restart yet — Task 2 must verify the LLM endpoint first.

---

## Task 2: Verify and Configure Contemplation LLM Endpoint for Anthropic

**Files:** Read `~/.openclaw/extensions/openclaw-plugin-contemplation/lib/reflect.js`  
**Pre-check:** Check what `callLLM()` actually does — does it call OpenAI-compatible endpoint or does it have Anthropic SDK support?

**Step 1:** Read `reflect.js` and find the `callLLM` function. Determine:
- Does it use `fetch()` with OpenAI-compatible `/v1/chat/completions` format?
- Or does it use the Anthropic SDK?
- What headers does it send? (Anthropic needs `x-api-key` + `anthropic-version`, not `Authorization: Bearer`)

**Step 2:** Based on findings:

**If OpenAI-compatible format (likely):** We need an OpenAI-compatible endpoint that routes to Anthropic. Options:
  - Use the gateway's own LLM proxy if available
  - Use LiteLLM or similar proxy
  - Point to `http://127.0.0.1:11434` if Ollama has an Anthropic model loaded
  - **Simplest**: If the gateway exposes an internal `/v1/chat/completions` proxy (check `openclaw status`), point there

**If Anthropic SDK:** Set the endpoint to `https://api.anthropic.com` and configure the API key via SecretRef.

**Step 3:** Update `~/.openclaw/openclaw.json` contemplation config with the correct endpoint + model + API key:
```json
"llm": {
  "endpoint": "<determined endpoint>",
  "model": "claude-sonnet-4-20250514",
  "maxTokens": 1500,
  "temperature": 0.6,
  "timeoutMs": 60000,
  "apiKey": "<if needed — use SecretRef>"
}
```

**Step 4:** Validate JSON + schema again.

**Step 5:** Commit if config changed:
```bash
cd ~/clawd && git add -A && git commit -m "fix(config): configure contemplation LLM endpoint for Anthropic Sonnet"
```

**Regression check:** This is a config-only change. No restart yet — we batch restart at Task 2.5.

---

## Task 2.5: Gateway Restart (after config tasks)

**Files:** None  
**Pre-check:** Follow GP-005 protocol (8 steps)

**Step 1:** Pre-flight:
```bash
openclaw config validate
python3 -c "import json; json.load(open('/home/coolmann/.openclaw/openclaw.json')); print('JSON: valid')"
openclaw status 2>&1 | grep -E 'session|agent'
```

**Step 2:** **STOP — Show pre-flight summary and get explicit human approval.**

**Step 3:** After approval:
```bash
systemctl --user restart openclaw-gateway
```

**Step 4:** Health check:
```bash
openclaw status 2>&1 | grep -E 'Gateway|running'
```

**Regression check:**
```bash
# Verify contemplation registered with nightshift
journalctl --user -u openclaw-gateway --since "2 min ago" | grep -i contemplation
# MUST see: "Registered nightshift task runner for \"contemplation\""
# MUST NOT see: new ERROR or WARN lines

# Verify both plugins loaded
journalctl --user -u openclaw-gateway --since "2 min ago" | grep -E "nightshift|contemplation" | head -10
```

---

## Task 3: Add Growth Vector Auto-Promotion Sweep to Metabolism Cron

**Files:** Modify `/home/coolmann/clawd/scripts/metabolism-cron.js`  
**Pre-check:**
```bash
cd ~/.openclaw/extensions/openclaw-plugin-metabolism && node test.js
```
Expected: 9/9 passed

**Step 1:** In `metabolism-cron.js`, add the following block AFTER the growth vectors write block (after line 89, before `const remaining = ...`):

```js
    // === Auto-promote mature growth vector candidates ===
    const MAX_VALIDATED = 20;
    const MIN_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
    const MIN_RECURRENCE = 2;

    try {
        let promoData = { vectors: [], candidates: [] };
        if (fs.existsSync(GROWTH_VECTORS_PATH)) {
            try { promoData = JSON.parse(fs.readFileSync(GROWTH_VECTORS_PATH, 'utf8')); } catch {}
        }
        promoData.vectors = promoData.vectors || [];
        promoData.candidates = promoData.candidates || [];

        const currentValidated = promoData.vectors.filter(
            v => v.validation_status === 'validated' || v.validation_status === 'integrated'
        ).length;

        if (currentValidated >= MAX_VALIDATED) {
            console.log(`[metabolism-cron] Skipping promotion: ${currentValidated} validated (cap: ${MAX_VALIDATED})`);
        } else {
            const now = Date.now();
            const budget = MAX_VALIDATED - currentValidated;
            const promoted = [];

            const eligible = promoData.candidates
                .filter(c => c.timestamp && (now - new Date(c.timestamp).getTime()) >= MIN_AGE_MS)
                .filter(c => (c.recurrence || 0) >= MIN_RECURRENCE)
                .sort((a, b) => (b.recurrence || 0) - (a.recurrence || 0));

            for (const c of eligible) {
                if (promoted.length >= budget) break;
                c.validation_status = 'validated';
                c.validation_note = `Auto-promoted by cron: age ${Math.round((now - new Date(c.timestamp).getTime()) / 3600000)}h, recurrence ${c.recurrence}`;
                c.promoted_at = new Date().toISOString();
                promoData.vectors.push(c);
                promoted.push(c.id || c.pattern || '(unnamed)');
            }

            if (promoted.length > 0) {
                const promotedSet = new Set(promoted);
                promoData.candidates = promoData.candidates.filter(c => !promotedSet.has(c.id || c.pattern || '(unnamed)'));
                fs.writeFileSync(GROWTH_VECTORS_PATH, JSON.stringify(promoData, null, 2));
                console.log(`[metabolism-cron] Promoted ${promoted.length} growth vector(s): ${promoted.join(', ')}`);
            }
        }
    } catch (e) {
        console.error(`[metabolism-cron] Promotion sweep error: ${e.message}`);
    }
```

**Step 2:** Test manually:
```bash
node /home/coolmann/clawd/scripts/metabolism-cron.js
```
Expected: runs without error. May show "Skipping promotion" (no candidates meet age+recurrence yet) or "Promoted N growth vector(s)".

**Step 3:** Verify growth-vectors.json structure:
```bash
python3 -c "
import json
d = json.load(open('$HOME/clawd/memory/growth-vectors.json'))
v = [x for x in d.get('vectors',[]) if x.get('validation_status') == 'validated']
print(f'Validated: {len(v)}, Candidates: {len(d.get(\"candidates\",[]))}')
"
```

**Step 4:** Commit:
```bash
cd ~/clawd && git add scripts/metabolism-cron.js && git commit -m "feat(metabolism): add auto-promotion sweep for growth vector candidates"
```

**Regression check:**
```bash
# Re-run metabolism tests
cd ~/.openclaw/extensions/openclaw-plugin-metabolism && node test.js
# Expected: 9/9 passed (cron changes don't affect plugin tests)

# Verify growth-vectors.json isn't corrupted
python3 -c "import json; json.load(open('$HOME/clawd/memory/growth-vectors.json')); print('valid')"
```

---

## Task 4: Verify Stability Injection Activates with Promoted Vectors

**Files:** None (read-only verification)  
**Pre-check:** Task 3 must be complete. At least 1 validated vector should exist.

**Step 1:** Check that stability's VectorStore can load validated vectors:
```bash
python3 -c "
import json
d = json.load(open('$HOME/clawd/memory/growth-vectors.json'))
validated = [v for v in d.get('vectors',[]) if v.get('validation_status') in ('validated','integrated')]
print(f'Stability will see {len(validated)} vectors')
for v in validated[:5]:
    print(f'  - {v.get(\"pattern\",\"?\")[:80]}')
"
```

**Step 2:** Start a test conversation after the gateway restart (Task 2.5). Check gateway logs:
```bash
journalctl --user -u openclaw-gateway --since "5 min ago" | grep -i "growth vector"
```
Should see injection-related log lines if any vectors scored high enough for the conversation topic.

**Regression check:** If no vectors appear in logs, check:
1. Are there validated vectors? (Step 1)
2. Does stability's `before_agent_start` fire? (`journalctl | grep -i stability`)
3. Does `getRelevantVectors` return results? (may need topic relevance to match)

---

## Task 5: Collect Gaps in Metabolism Cron

**Files:** Modify `/home/coolmann/clawd/scripts/metabolism-cron.js`  
**Pre-check:**
```bash
cd ~/.openclaw/extensions/openclaw-plugin-metabolism && node test.js
```
Expected: 9/9 passed

**Step 1:** In `metabolism-cron.js`, add `allGaps` array declaration after `allGrowthVectors` (after line 57):
```js
    const allGaps = [];
```

**Step 2:** Inside the `for (const c of candidates)` loop, after the growth vector collection block (after line 67 — after `allGrowthVectors.push(...result.growthVectors);`), add:
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

**Step 3:** After the growth vectors write block AND after the auto-promotion sweep (Task 3), before `const remaining = ...`, add the gap queue write:
```js
    // Write gaps to contemplation file queue
    if (allGaps.length > 0) {
        const GAPS_QUEUE_PATH = path.join(
            process.env.HOME,
            '.openclaw/extensions/openclaw-plugin-contemplation/data/pending-gaps.json'
        );
        try {
            let existingGaps = [];
            if (fs.existsSync(GAPS_QUEUE_PATH)) {
                try { existingGaps = JSON.parse(fs.readFileSync(GAPS_QUEUE_PATH, 'utf8')); } catch { existingGaps = []; }
            }
            existingGaps.push(...allGaps);
            if (existingGaps.length > 50) existingGaps = existingGaps.slice(-50);
            const tmpPath = GAPS_QUEUE_PATH + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(existingGaps, null, 2));
            fs.renameSync(tmpPath, GAPS_QUEUE_PATH);
            console.log(`[metabolism-cron] Queued ${allGaps.length} gap(s) for contemplation`);
        } catch (e) {
            console.error(`[metabolism-cron] Gap queue write error: ${e.message}`);
        }
    }
```

**Step 4:** Test:
```bash
node /home/coolmann/clawd/scripts/metabolism-cron.js
```
Expected: runs without error. If candidates were processed and had gaps, shows "Queued N gap(s)".

**Step 5:** Commit:
```bash
cd ~/clawd && git add scripts/metabolism-cron.js && git commit -m "feat(metabolism): collect and queue gaps for contemplation"
```

**Regression check:**
```bash
cd ~/.openclaw/extensions/openclaw-plugin-metabolism && node test.js
# Expected: 9/9 passed
```

---

## Task 6: Add Gap File Ingestion to Contemplation Plugin

**Files:** Modify `~/.openclaw/extensions/openclaw-plugin-contemplation/index.js`  
**Pre-check:**
```bash
cd ~/.openclaw/extensions/openclaw-plugin-contemplation && node test/test.js
```
Expected: 1/2 passed, 1 failed (pre-existing regex bug — `I am curious` vs `I'm curious`)

**Step 1:** In `contemplation/index.js`, add the `ingestFileQueue` function BEFORE the `register()` method's `api.on('agent_end', ...)` hook (around line 155, after the nightshift `registerTaskRunner` block at ~line 133). Add it inside `register()`, after the `getState` function:

```js
    /**
     * Ingest gaps from the file-based queue written by metabolism-cron.
     * Reads pending-gaps.json, creates inquiries, truncates the file.
     */
    function ingestFileQueue(state, logger) {
        const queuePath = path.join(__dirname, 'data', 'pending-gaps.json');
        if (!fs.existsSync(queuePath)) return 0;

        let gaps;
        try {
            const raw = fs.readFileSync(queuePath, 'utf8');
            gaps = JSON.parse(raw);
            if (!Array.isArray(gaps) || gaps.length === 0) return 0;
            fs.writeFileSync(queuePath, '[]');
        } catch (e) {
            if (logger) logger.warn(`[Contemplation] Gap queue read error: ${e.message}`);
            return 0;
        }

        const maxAge = 60 * 60 * 1000; // 1 hour
        const now = Date.now();
        let ingested = 0;

        for (const gap of gaps) {
            if (gap.timestamp && (now - new Date(gap.timestamp).getTime()) > maxAge) continue;
            const inquiry = state.store.addInquiry({
                question: gap.question,
                source: gap.source || 'metabolism:cron',
                entropy: 0,
                context: gap.question
            });
            // Tag asynchronously
            tagInquiry(state.store, inquiry, config, logger).catch(() => {});
            ingested++;
        }

        if (ingested > 0 && logger) {
            logger.info(`[Contemplation] Ingested ${ingested} gap(s) from file queue`);
        }
        return ingested;
    }
```

**Step 2:** Hook into the heartbeat handler. Find the existing `api.on('heartbeat', ...)` block (around line 218). Add `ingestFileQueue` call at the TOP of the callback, BEFORE the nightshift check:

Current:
```js
    api.on('heartbeat', async (event, ctx) => {
      if (global.__ocNightshift?.queueTask) return; // nightshift handles it
```

New:
```js
    api.on('heartbeat', async (event, ctx) => {
      // Ingest file-queued gaps regardless of nightshift presence
      const state = getState(ctx.agentId);
      ingestFileQueue(state, api.logger);

      if (global.__ocNightshift?.queueTask) return; // nightshift handles pass execution
```

> **Key insight**: Gap ingestion must happen EVEN when nightshift is present. The heartbeat handler currently returns early when nightshift exists. We ingest gaps BEFORE that check. Gap ingestion creates inquiries; pass execution is what nightshift handles.

**Step 3:** Validate syntax:
```bash
node -c ~/.openclaw/extensions/openclaw-plugin-contemplation/index.js
```
Expected: no syntax errors.

**Step 4:** Commit:
```bash
cd ~/clawd && git add ~/.openclaw/extensions/openclaw-plugin-contemplation/index.js && git commit -m "feat(contemplation): add file-based gap queue ingestion from metabolism cron"
```

**Regression check:**
```bash
cd ~/.openclaw/extensions/openclaw-plugin-contemplation && node test/test.js
# Expected: 1/2 passed, 1 failed (same pre-existing failure — our changes don't affect extractor tests)
```

---

## Task 7: Test Gap Queue End-to-End

**Files:** None (verification only)  
**Pre-check:** Tasks 5 and 6 must be complete. Gateway must be restarted (if not done since Task 6 — restart now following GP-005).

**Step 1:** Create a test gap file:
```bash
echo '[{"question":"test gap from implementation plan","source":"test:manual","sourceId":"test","timestamp":"'$(date -u +%FT%TZ)'"}]' > ~/.openclaw/extensions/openclaw-plugin-contemplation/data/pending-gaps.json
```

**Step 2:** Wait for next heartbeat (check gateway logs), then verify:
```bash
# Gap file should be empty
cat ~/.openclaw/extensions/openclaw-plugin-contemplation/data/pending-gaps.json
# Expected: []

# Inquiries should have the test gap
python3 -c "
import json
d = json.load(open('$HOME/.openclaw/extensions/openclaw-plugin-contemplation/data/agents/main/inquiries.json'))
for i in d.get('inquiries',[])[-3:]:
    print(f'{i[\"id\"]}: {i[\"question\"][:60]} (source: {i.get(\"source\",\"?\")})')
"
```
Expected: new inquiry with source `test:manual` and question "test gap from implementation plan".

**Step 3:** Check gateway logs:
```bash
journalctl --user -u openclaw-gateway --since "5 min ago" | grep -i "gap.*queue\|Ingested"
```
Expected: `[Contemplation] Ingested 1 gap(s) from file queue`

**Regression check:** Start a normal conversation and verify contemplation's agent_end hook still works (creates inquiries from conversation). Check logs for `[Contemplation:main] Queued inquiry`.

---

## Task 8: Add `superseded_at` Column to facts.db Schema

**Files:** Modify `~/.openclaw/extensions/openclaw-plugin-metabolism/lib/insert-facts.js`  
**Pre-check:**
```bash
cd ~/.openclaw/extensions/openclaw-plugin-metabolism && node test.js
```
Expected: 9/9 passed

**Step 1:** In `insert-facts.js`, after the existing `CREATE UNIQUE INDEX` block (after line ~207, where `try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_facts_entity_key ...`) and before the prepared statements section, add:

```js
    // Ensure superseded_at column exists (idempotent migration)
    try { db.exec('ALTER TABLE facts ADD COLUMN superseded_at TEXT DEFAULT NULL'); } catch { /* already exists */ }
    try { db.exec('ALTER TABLE facts ADD COLUMN superseded_by TEXT DEFAULT NULL'); } catch { /* already exists */ }
```

**Step 2:** Modify the `stmtUpdate` prepared statement (around line ~218). Current:
```js
    const stmtUpdate = db.prepare(`
        UPDATE facts SET value = ?, category = ?, source = ?, last_accessed = datetime('now')
        WHERE entity = ? AND key = ?
    `);
```
New:
```js
    const stmtUpdate = db.prepare(`
        UPDATE facts SET value = ?, category = ?, source = ?, last_accessed = datetime('now'),
        superseded_at = NULL, superseded_by = NULL
        WHERE entity = ? AND key = ?
    `);
```

> **Why `superseded_at = NULL` on update?** If a fact was manually superseded and then re-emerges via metabolism, it un-supersedes. Latest upsert wins.

**Step 3:** Test:
```bash
cd ~/.openclaw/extensions/openclaw-plugin-metabolism && node test.js
```
Expected: 9/9 passed.

**Step 4:** Verify column was added:
```bash
sqlite3 ~/.openclaw/data/facts.db "PRAGMA table_info(facts)" | grep superseded
```
Expected: two rows showing `superseded_at` and `superseded_by` columns.

> **Note**: The column will be added on the NEXT metabolism cron run (when `insertFacts` opens the DB). To add it immediately, run:
> ```bash
> sqlite3 ~/.openclaw/data/facts.db "ALTER TABLE facts ADD COLUMN superseded_at TEXT DEFAULT NULL;" 2>/dev/null; echo "done"
> sqlite3 ~/.openclaw/data/facts.db "ALTER TABLE facts ADD COLUMN superseded_by TEXT DEFAULT NULL;" 2>/dev/null; echo "done"
> ```

**Step 5:** Commit:
```bash
cd ~/clawd && git add ~/.openclaw/extensions/openclaw-plugin-metabolism/lib/insert-facts.js && git commit -m "feat(facts): add superseded_at/superseded_by columns for fact invalidation"
```

**Regression check:**
```bash
# Verify all facts still visible (none superseded yet)
sqlite3 ~/.openclaw/data/facts.db "SELECT COUNT(*) FROM facts WHERE superseded_at IS NOT NULL"
# Expected: 0

# Verify total count unchanged
sqlite3 ~/.openclaw/data/facts.db "SELECT COUNT(*) FROM facts"
```

---

## Task 9: Filter Superseded Facts in Continuity FactsSearcher

**Files:** Modify `~/.openclaw/extensions/openclaw-plugin-continuity/storage/facts-searcher.js`  
**Pre-check:** Task 8 must be complete (column must exist in facts.db).

**Step 1:** Modify the prepared statements in `_prepareStatements()` (line ~414). Current:
```js
    _prepareStatements() {
        this._stmts = {
            resolveAlias: this._db.prepare(
                'SELECT entity FROM aliases WHERE alias = ? COLLATE NOCASE'
            ),
            resolveEntity: this._db.prepare(
                'SELECT DISTINCT entity FROM facts WHERE entity = ? COLLATE NOCASE'
            ),
            factsByEntityIntent: this._db.prepare(
                'SELECT rowid as id, key, value, source FROM facts WHERE entity = ? AND key LIKE ?'
            ),
            factsByEntity: this._db.prepare(
                'SELECT rowid as id, key, value, source FROM facts WHERE entity = ?'
            ),
        };
    }
```
New:
```js
    _prepareStatements() {
        this._stmts = {
            resolveAlias: this._db.prepare(
                'SELECT entity FROM aliases WHERE alias = ? COLLATE NOCASE'
            ),
            resolveEntity: this._db.prepare(
                'SELECT DISTINCT entity FROM facts WHERE entity = ? COLLATE NOCASE AND (superseded_at IS NULL OR superseded_at = "")'
            ),
            factsByEntityIntent: this._db.prepare(
                'SELECT rowid as id, key, value, source FROM facts WHERE entity = ? AND key LIKE ? AND (superseded_at IS NULL OR superseded_at = "")'
            ),
            factsByEntity: this._db.prepare(
                'SELECT rowid as id, key, value, source FROM facts WHERE entity = ? AND (superseded_at IS NULL OR superseded_at = "")'
            ),
        };
    }
```

> **Why `superseded_at IS NULL OR superseded_at = ""`?** Belt-and-suspenders. The column defaults to NULL but some code paths might set it to empty string. Both should be treated as "not superseded".

**Step 2:** Modify the `getStats()` method (line ~247). Update the total count query:
Current:
```js
            const total = this._db.prepare('SELECT COUNT(*) as c FROM facts').get().c;
            const permanent = this._db.prepare('SELECT COUNT(*) as c FROM facts WHERE permanent = 1').get().c;
```
New:
```js
            const total = this._db.prepare('SELECT COUNT(*) as c FROM facts WHERE superseded_at IS NULL').get().c;
            const permanent = this._db.prepare('SELECT COUNT(*) as c FROM facts WHERE permanent = 1 AND superseded_at IS NULL').get().c;
```

**Step 3:** Modify the `_ftsSearchFacts()` method (line ~370). After the FTS query returns rows, add a post-filter BEFORE the `return rows.map(...)` block. The FTS virtual table doesn't have `superseded_at`, so we filter after:

Current (line ~382):
```js
            return rows.map(row => {
                const source = this._db.prepare(
                    'SELECT source FROM facts WHERE entity = ? AND key = ?'
                ).get(row.entity, row.key);
```
New:
```js
            // Filter out superseded facts (FTS table doesn't have superseded_at)
            const activeRows = rows.filter(row => {
                const fact = this._db.prepare(
                    'SELECT superseded_at FROM facts WHERE entity = ? AND key = ?'
                ).get(row.entity, row.key);
                return !fact?.superseded_at;
            });

            return activeRows.map(row => {
                const source = this._db.prepare(
                    'SELECT source FROM facts WHERE entity = ? AND key = ?'
                ).get(row.entity, row.key);
```

**Step 4:** Also update the initialization count query (line ~134):
Current:
```js
            const count = this._db.prepare('SELECT COUNT(*) as c FROM facts').get().c;
```
New:
```js
            const count = this._db.prepare('SELECT COUNT(*) as c FROM facts WHERE superseded_at IS NULL').get().c;
```

**Step 5:** Validate syntax:
```bash
node -c ~/.openclaw/extensions/openclaw-plugin-continuity/storage/facts-searcher.js
```

**Step 6:** Commit:
```bash
cd ~/clawd && git add ~/.openclaw/extensions/openclaw-plugin-continuity/storage/facts-searcher.js && git commit -m "feat(continuity): filter superseded facts in FactsSearcher queries"
```

**Regression check:** Gateway restart required for this change. After restart:
```bash
# Verify facts still appear in continuity context
# Start a conversation mentioning a known entity (e.g., "what do you know about Sascha?")
# Check that facts are returned in [CONTINUITY CONTEXT]

# Verify count is unchanged (no facts superseded yet)
journalctl --user -u openclaw-gateway --since "2 min ago" | grep -i FactsSearcher
# Should show "Ready — N facts" with same count as before
```

---

## Task 10: Strengthen LLM Prompt for Key Consistency

**Files:** Modify `~/.openclaw/extensions/openclaw-plugin-metabolism/lib/processor.js`  
**Pre-check:**
```bash
cd ~/.openclaw/extensions/openclaw-plugin-metabolism && node test.js
```
Expected: 9/9 passed

**Step 1:** In `processor.js`, find the `KEY RULES` section (around line ~640, after the PREFERRED KEYS block). Add this paragraph BEFORE the existing "KEY RULES:" line:

```
CRITICAL KEY REUSE RULE: Before choosing a key name for an entity, check the KNOWN ENTITIES section above. If that entity already has a fact with a similar key, use the EXACT same key name. Examples:
- Entity "Gandalf" already has key "model" → use "model", NOT "llm_model" or "backend_model" or "ai_model"
- Entity "Sascha" already has key "location" → use "location", NOT "city" or "home_city" or "residence"  
Reusing existing keys triggers an UPDATE (keeping one clean value) instead of creating duplicate conflicting facts.

```

**Step 2:** Test:
```bash
cd ~/.openclaw/extensions/openclaw-plugin-metabolism && node test.js
```
Expected: 9/9 passed (prompt changes don't break processing tests).

**Step 3:** Commit:
```bash
cd ~/clawd && git add ~/.openclaw/extensions/openclaw-plugin-metabolism/lib/processor.js && git commit -m "feat(metabolism): strengthen LLM prompt for key consistency to reduce fact duplication"
```

**Regression check:** Next metabolism cron run should process candidates with the updated prompt. Monitor for key consistency:
```bash
# After next cron run, check recent facts for duplicate-style keys
sqlite3 ~/.openclaw/data/facts.db "SELECT entity, key, value FROM facts ORDER BY rowid DESC LIMIT 20"
```

---

## Final Gateway Restart (after Tasks 8-10)

Follow GP-005 protocol. This restart activates:
- FactsSearcher superseded_at filtering (Task 9)

```bash
openclaw config validate
python3 -c "import json; json.load(open('/home/coolmann/.openclaw/openclaw.json')); print('JSON: valid')"
# Show pre-flight summary → get human approval
systemctl --user restart openclaw-gateway
openclaw status 2>&1 | grep -E 'Gateway|running'
journalctl --user -u openclaw-gateway --since "2 min ago" | grep -E "ERROR|WARN|FactsSearcher|Contemplation"
```

---

## Test Tasks (TDD — write tests before or alongside implementation)

### Test A: Fix Contemplation Extractor Regex (pre-existing bug)
**Files:** Modify `~/.openclaw/extensions/openclaw-plugin-contemplation/lib/extractor.js`
**Why:** The `GAP_PATTERNS` regex matches `I'm curious` but not `I am curious`. Fix the regex to handle both contractions.

**Step 1:** Find the regex pattern for "curious" in extractor.js and update to match both forms:
- `I'm curious` → `I(?:'m| am) curious`
- Apply same pattern to any other contraction-dependent regexes

**Step 2:** Run existing tests:
```bash
cd ~/.openclaw/extensions/openclaw-plugin-contemplation && node test/test.js
```
Expected: 2/2 passed (the previously failing test should now pass)

**Step 3:** Commit:
```bash
cd ~/clawd && git add ~/.openclaw/extensions/openclaw-plugin-contemplation/ && git commit -m "fix(contemplation): extractor regex handles both contractions and expanded forms"
```

---

### Test B: Auto-Promotion Sweep Unit Test
**Files:** Create `~/clawd/scripts/test-promotion-sweep.js`

**Test cases:**
1. Candidate age < 24h, recurrence >= 2 → NOT promoted
2. Candidate age >= 24h, recurrence < 2 → NOT promoted
3. Candidate age >= 24h, recurrence >= 2 → promoted
4. Already 20 validated vectors → no promotion (cap)
5. 18 validated + 5 eligible → only 2 promoted (budget)
6. Promotion sorts by recurrence (highest first)

**Step 1:** Write the test file with mock growth-vectors.json data
**Step 2:** Run: `node ~/clawd/scripts/test-promotion-sweep.js`
**Step 3:** Commit alongside Task 3

---

### Test C: Gap Queue Ingestion Unit Test
**Files:** Create `~/.openclaw/extensions/openclaw-plugin-contemplation/test/test-gap-queue.js`

**Test cases:**
1. No queue file exists → returns 0, no error
2. Empty array in queue → returns 0
3. Valid gaps → creates inquiries, empties queue file
4. Gaps older than 1 hour → filtered out
5. Malformed JSON in queue → returns 0, logs warning
6. Mixed valid + stale gaps → only valid ones ingested

**Step 1:** Write the test file
**Step 2:** Run: `node ~/.openclaw/extensions/openclaw-plugin-contemplation/test/test-gap-queue.js`
**Step 3:** Commit alongside Task 6

---

### Test D: Facts Invalidation Unit Test
**Files:** Create `~/.openclaw/extensions/openclaw-plugin-metabolism/test/test-superseded.js`

**Test cases:**
1. Insert fact → `superseded_at` is NULL
2. Upsert same entity+key with new value → old value replaced, `superseded_at` stays NULL (upsert, not supersede)
3. Manually set `superseded_at` → FactsSearcher excludes it
4. Re-upsert a superseded fact → `superseded_at` cleared (un-supersede)
5. FTS search excludes superseded facts
6. Stats count excludes superseded facts

**Step 1:** Write the test file with a temp SQLite DB
**Step 2:** Run: `node ~/.openclaw/extensions/openclaw-plugin-metabolism/test/test-superseded.js`
**Step 3:** Commit alongside Tasks 8-9

---

## Full Regression Checklist (run after all tasks complete)

```bash
# 1. Metabolism tests
cd ~/.openclaw/extensions/openclaw-plugin-metabolism && node test.js
# Expected: 9/9 passed

# 2. Contemplation tests
cd ~/.openclaw/extensions/openclaw-plugin-contemplation && node test/test.js
# Expected: 1/2 passed, 1 failed (pre-existing)

# 3. Gateway health
openclaw status 2>&1 | grep -E 'Gateway|running|ERROR'

# 4. Contemplation nightshift registration
journalctl --user -u openclaw-gateway --since "10 min ago" | grep "Registered nightshift task runner"

# 5. Facts accessible
sqlite3 ~/.openclaw/data/facts.db "SELECT COUNT(*) FROM facts WHERE superseded_at IS NULL"

# 6. Growth vectors
python3 -c "
import json
d = json.load(open('$HOME/clawd/memory/growth-vectors.json'))
v = len([x for x in d.get('vectors',[]) if x.get('validation_status') == 'validated'])
c = len(d.get('candidates',[]))
print(f'Validated: {v}, Candidates: {c}')
"

# 7. No new errors in last 10 minutes
journalctl --user -u openclaw-gateway --since "10 min ago" | grep -c ERROR
# Expected: 0
```
