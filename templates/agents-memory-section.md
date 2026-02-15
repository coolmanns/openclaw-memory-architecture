# Memory Section for AGENTS.md

> Copy the relevant sections below into your agent's AGENTS.md file.

## Every Session — Boot Sequence

Before doing anything else:
1. Read `SOUL.md` — this is who you are
2. Read `USER.md` — this is who you're helping
3. Read `memory/active-context.md` — what's hot right now (ALWAYS, every session)
4. Read `memory/YYYY-MM-DD.md` (today + yesterday) for recent context
5. **If in MAIN SESSION** (direct chat with your human): Also read `MEMORY.md`
6. Check `memory/gating-policies.md` if doing anything risky

Don't ask permission. Just do it.

## Memory Layers

### 🧠 MEMORY.md - Your Long-Term Memory
- **ONLY load in main session** (direct chats with your human)
- **DO NOT load in shared contexts** (Discord, group chats)
- This is your curated memory — distilled essence, not raw logs
- Over time, review daily files and promote what's worth keeping

### ⚡ active-context.md - Your Working Memory
- **Load EVERY session** — this is what you need to know RIGHT NOW
- Contains: active projects, pending decisions, commitments, session handoff notes
- **Update at the END of every significant session** — future-you depends on it
- **Prune weekly** — completed items removed, lessons promoted to MEMORY.md
- Target: <2KB. If it's getting fat, you're not pruning enough.

### 🔒 gating-policies.md - Failure Prevention
- Numbered rules (GP-XXX) learned from actual failures
- **When doing anything risky, check this file first**
- When something goes wrong, **add a new policy in the same turn**
- Format: ID | Trigger | Action | What went wrong

### 📊 facts.db - Structured Facts (SQLite + FTS5)
- `memory/facts.db` — entity/key/value store for precise lookups
- Use for: birthdays, preferences, decisions, credentials, project details
- Query: `python3 -c "import sqlite3; db=sqlite3.connect('memory/facts.db'); print(db.execute('SELECT value FROM facts WHERE entity=? AND key=?', ('Alice','birthday')).fetchone()[0])"`
- FTS search: `SELECT * FROM facts_fts WHERE facts_fts MATCH 'birthday'`
- **When learning new structured facts, add them to facts.db AND the relevant .md file**

### 🏁 checkpoints/ - Pre-Flight State Saves
- Before risky operations (config changes, refactors, deployments): save state to `memory/checkpoints/`
- Contains: what you're about to do, current state, expected outcome, rollback plan
- Auto-expire: clean up after successful completion or 4 hours

### 📝 Write It Down - No "Mental Notes"!
- **Memory is limited** — if you want to remember something, WRITE IT TO A FILE
- "Mental notes" don't survive session restarts. Files do.
- When someone says "remember this" → update the appropriate memory file
- When you learn a lesson → update gating-policies.md
- When you make a mistake → document it so future-you doesn't repeat it
- **Text > Brain** 📝
