# OpenClaw Memory Architecture

A multi-layered memory system for OpenClaw agents that combines structured storage, semantic search, and cognitive patterns to give your agent persistent, reliable memory.

**The problem:** AI agents wake up fresh every session. Context compression eats older messages mid-conversation. Your agent forgets what you told it yesterday.

**The solution:** Don't rely on one approach. Use the right memory layer for each type of recall.

## Why Not Just Vector Search?

Vector search (embeddings) is great for fuzzy recall — *"what were we talking about regarding infrastructure?"* — but it's overkill for 80% of what a personal assistant actually needs:

- "What's my daughter's birthday?" → **Structured lookup** (instant, exact)
- "What did we decide about the database?" → **Decision fact** (instant, exact)
- "What happened last week with the deployment?" → **Semantic search** (fuzzy, slower)

This architecture uses **each tool where it's strongest**.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                  SESSION CONTEXT                      │
│            (~200K token window)                        │
├──────────────────────────────────────────────────────┤
│                                                       │
│  ┌────────────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ active-context │  │ MEMORY   │  │   USER.md    │ │
│  │ .md            │  │ .md      │  │              │ │
│  │                │  │          │  │  Who your    │ │
│  │ Working memory │  │ Curated  │  │  human is    │ │
│  │ What's hot NOW │  │ wisdom   │  │              │ │
│  └───────┬────────┘  └────┬─────┘  └──────────────┘ │
│          │                │                           │
│  ┌───────┴────────────────┴────────────────────────┐ │
│  │            SEMANTIC SEARCH                       │ │
│  │   QMD / Ollama / OpenAI embeddings              │ │
│  └───────┬────────────────┬────────────────────────┘ │
│          │                │                           │
│  ┌───────┴──────┐  ┌─────┴──────┐  ┌─────────────┐ │
│  │  facts.db    │  │ YYYY-MM-DD │  │ gating-     │ │
│  │  (SQLite +   │  │ .md (daily │  │ policies.md │ │
│  │   FTS5)      │  │  logs)     │  │ (failure    │ │
│  │              │  │            │  │  rules)     │ │
│  │  Structured  │  │  Raw       │  │             │ │
│  │  facts       │  │  events    │  │  GP-001...  │ │
│  └──────────────┘  └────────────┘  └─────────────┘ │
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │           PROJECT MEMORY                          │ │
│  │  memory/project-{slug}.md per project             │ │
│  │  Agent-independent institutional knowledge:       │ │
│  │  decisions, lessons, conventions, risks            │ │
│  │  Created by wizard · Read by all agents at boot   │ │
│  │  Updated by PM at phase close                     │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  ┌──────────────┐  ┌──────────────┐                  │
│  │ tools-*.md   │  │ checkpoints/ │                  │
│  │ (runbooks)   │  │ (pre-flight) │                  │
│  └──────────────┘  └──────────────┘                  │
│                                                       │
├──────────────────────────────────────────────────────┤
│              PLUGIN LAYERS (NEW in v3)                │
├──────────────────────────────────────────────────────┤
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │         CONTINUITY PLUGIN                         │ │
│  │  Cross-session conversation archive               │ │
│  │  SQLite-vec semantic search (384d embeddings)     │ │
│  │  Topic tracking & fixation detection              │ │
│  │  Continuity anchors (identity, contradiction)     │ │
│  │  Context budgeting (priority-tiered compaction)   │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │         STABILITY PLUGIN                          │ │
│  │  Entropy monitoring (drift detection)             │ │
│  │  Principle alignment (from SOUL.md)               │ │
│  │  Loop detection (tool + file re-read guards)      │ │
│  │  Heartbeat decision framework                     │ │
│  │  Confabulation detection                          │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
└──────────────────────────────────────────────────────┘
```

## Layers

### Layer 1: Always-Loaded Context
Files injected into every session start. Keep them **lean** (total <2K tokens).

| File | Purpose | Target Size |
|------|---------|-------------|
| `active-context.md` | What's happening right now | <2KB |
| `MEMORY.md` | Long-term curated wisdom | <8KB |
| `USER.md` | Who your human is | <3KB |

### Layer 2: Project Memory
Per-project institutional knowledge that survives agent resets and compaction.

```
memory/project-clawsmith.md    — architecture decisions, lessons, conventions
memory/project-my-app.md       — same pattern, different project
```

**The problem it solves:** When agents reset or compact, project knowledge vanishes. Toby forgets the pull-based workflow. Pete loses architecture decisions. New agents start from zero.

**The fix:** One file per project, agent-independent, maintained by the PM at phase close:

```
Wizard creates project → seeds project-{slug}.md
All project agents read at boot (step 1)
Agents work, learn, make decisions
PM consolidates at phase close → updates project-{slug}.md
Agent resets → boots with institutional knowledge intact
```

**What goes in:** Architecture decisions, hard-won lessons, workflow patterns, conventions, known risks.
**What stays out:** Backlog items, sprint status, daily logs — those are the DB's job.

Template: [`templates/project-memory.md`](templates/project-memory.md)

### Layer 3: Structured Facts (SQLite + FTS5)
For precise lookups that don't need embeddings.

```sql
-- "What's Janna's birthday?"
SELECT value FROM facts WHERE entity='Janna' AND key='birthday';
-- → "July 7, 1976" (instant, zero API calls)

-- Full-text search
SELECT * FROM facts_fts WHERE facts_fts MATCH 'birthday';
-- → All 6 family birthdays (instant, zero API calls)
```

Categories: `person`, `project`, `decision`, `convention`, `credential`, `preference`, `date`, `location`

### Layer 4: Semantic Search
For fuzzy recall where keywords don't match but meaning does. Works with:
- **QMD** (OpenClaw's built-in) — reranking + query expansion
- **Ollama** (local embeddings) — zero cost, 61ms
- **OpenAI** (cloud) — higher quality, per-call cost

### Layer 5: Daily Logs
`memory/YYYY-MM-DD.md` — raw session logs. What happened today. Source material for curation.

#### Importance Tagging

Every observation in a daily log gets an importance tag that controls retention:

```markdown
- [decision|i=0.9] Switched from PostgreSQL to SQLite for facts storage
- [milestone|i=0.85] Shipped v2.0 of memory architecture to GitHub
- [lesson|i=0.7] Partial array patches in config.patch nuke the entire list
- [task|i=0.6] Need to add rate limiting to the embedding endpoint
- [context|i=0.3] Ran routine memory maintenance, nothing notable
```

**Tag reference:**

| Tag | Importance | Meaning | Example |
|-----|-----------|---------|---------|
| `decision` | 0.9 | Choices made | Switched ORMs, picked a model |
| `milestone` | 0.85 | Things shipped/deployed/published | Released v2.0, deployed to prod |
| `lesson` | 0.7 | What you learned | "Don't partial-patch arrays" |
| `task` | 0.6 | Work identified but not done | "Need to add auth to endpoint" |
| `context` | 0.3 | Routine status, minor updates | "Ran backups, all green" |

**Retention tiers:**

| Tier | Importance | Retention | Rationale |
|------|-----------|-----------|-----------|
| **STRUCTURAL** | i ≥ 0.8 | Permanent | Decisions and milestones define the project's history |
| **POTENTIAL** | 0.4 ≤ i < 0.8 | 30 days | Lessons and tasks stay relevant for ~a month |
| **CONTEXTUAL** | i < 0.4 | 7 days | Routine status loses value fast |

#### Auto-Pruning

`scripts/prune-memory.py` enforces these retention tiers automatically:

```bash
# Preview what would be pruned
python3 scripts/prune-memory.py --dry-run

# Actually prune
python3 scripts/prune-memory.py
```

Run it on a cron, during heartbeats, or manually. It scans `memory/YYYY-MM-DD.md` files, removes expired observations, and reports structural items worth promoting to `MEMORY.md`.

### Layer 6: Gating Policies
Numbered failure prevention rules learned from actual mistakes:

```
GP-001 | Before config.patch on arrays | Read current, modify in full | Partial array patch nuked all agents
GP-004 | Before stating any date/time  | Run TZ command first         | Timezone mistakes from mental math
```

### Layer 7: Pre-Flight Checkpoints
State saves before risky operations. If compaction hits mid-task, checkpoints survive.

### Layer 8: Procedural Memory (Runbooks)
`tools-*.md` files documenting HOW to do things — API endpoints, auth flows, multi-step procedures. Survives model switches and compaction.

## Information Flow

### Upward (Consolidation)
```
Daily logs → active-context.md → MEMORY.md → facts.db
(raw)        (working memory)    (curated)   (structured)

Session work → phase close → project-{slug}.md
(ephemeral)   (PM gate)      (institutional)
```

### Session Boot Sequence

**Main agent (personal assistant):**
```
1. Read SOUL.md (who am I)
2. Read USER.md (who am I helping)
3. Read active-context.md (what's hot)
4. Read today's + yesterday's daily log
5. Read MEMORY.md
6. [On demand] Semantic search for specific recalls
7. [On demand] facts.db for structured lookups
8. [If risky task] Check gating-policies.md
```

**Project agents (dev, PM, QA, etc.):**
```
1. Read memory/project-{slug}.md (institutional knowledge — FIRST)
2. Read SOUL.md / IDENTITY.md (who am I)
3. Agent-specific boot steps (query project DB, check work queue, etc.)
4. Read today's daily log for recent context
```

### Session End (SLEEP)

Before a session ends, gets compacted, or when context is getting heavy:

```
1. Update memory/active-context.md — what the next session needs to know
2. Write observations to memory/YYYY-MM-DD.md with importance tags
3. If significant work happened → update MEMORY.md with distilled insights
```

This is the other half of the Wake/Sleep cycle. WAKE loads context; SLEEP preserves it. Without SLEEP, the next session boots blind.

## Setup

### 1. Create the directory structure

```bash
mkdir -p memory/checkpoints memory/runbooks
```

### 2. Initialize facts.db

```bash
python3 scripts/init-facts-db.py
```

Or manually:

```bash
python3 -c "
import sqlite3
db = sqlite3.connect('memory/facts.db')
db.executescript(open('schema/facts.sql').read())
db.close()
print('facts.db created')
"
```

### 3. Seed with your facts

Edit `scripts/seed-facts.py` with your personal facts, then run:

```bash
python3 scripts/seed-facts.py
```

### 4. Copy templates

```bash
cp templates/active-context.md memory/active-context.md
cp templates/gating-policies.md memory/gating-policies.md
```

### 5. Update your AGENTS.md

Add the boot sequence and memory sections from `templates/agents-memory-section.md` to your agent's workspace.

### 6. Configure semantic search (optional but recommended)

For local embeddings with Ollama:

```json
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "enabled": true,
        "provider": "openai",
        "remote": {
          "baseUrl": "http://localhost:11434/v1",
          "apiKey": "ollama"
        },
        "model": "nomic-embed-text",
        "fallback": "none"
      }
    }
  }
}
```

## Quick Reference

### Adding a fact
```python
python3 -c "
import sqlite3
db = sqlite3.connect('memory/facts.db')
db.execute('INSERT INTO facts (entity, key, value, category, source, permanent) VALUES (?, ?, ?, ?, ?, ?)',
    ('Alice', 'birthday', 'March 15, 1990', 'date', 'conversation', 1))
db.commit()
print('Added')
"
```

### Querying facts
```python
python3 -c "
import sqlite3
db = sqlite3.connect('memory/facts.db')
# Exact lookup
print(db.execute('SELECT value FROM facts WHERE entity=? AND key=?', ('Alice', 'birthday')).fetchone()[0])
# Full-text search
for row in db.execute('SELECT entity, key, value FROM facts_fts WHERE facts_fts MATCH ?', ('birthday',)):
    print(f'{row[0]}.{row[1]} = {row[2]}')
"
```

### Adding a gating policy
When something goes wrong, add a rule to `memory/gating-policies.md`:

```
| GP-XXX | [trigger condition] | [required action] | [what went wrong and when] |
```

## Plugin Layers (NEW in v3)

Two OpenClaw plugins add runtime memory capabilities that operate **during** conversations, not just at boot time.

### Layer 9: Continuity Plugin (`openclaw-plugin-continuity`)

Cross-session memory and conversation awareness. Runs as an OpenClaw gateway plugin.

**What it does:**
- **Conversation archive** — Stores all exchanges in SQLite with SQLite-vec embeddings (384d, `all-MiniLM-L6-v2`). Survives session resets.
- **Semantic search** — "What were we discussing about infrastructure last week?" searches across archived conversations, not just memory files.
- **Topic tracking** — Detects what topics are active, fixated (repeated too often), or fading. Injects `[CONTINUITY CONTEXT]` into prompts with session stats and active topics.
- **Continuity anchors** — Detects identity moments, contradictions, and tensions in conversation. Preserves them through compaction.
- **Context budgeting** — Priority-tiered token allocation. Recent turns get full text, older turns get compressed. Configurable pool ratios (essential/high/medium/low/minimal).

**Data location:** `~/.openclaw/extensions/openclaw-plugin-continuity/data/`
- `continuity.db` — SQLite + SQLite-vec archive (conversations + embeddings)
- `archive/` — JSON conversation archives by date

**Config:** Fully configurable via `openclaw.plugin.json` — token budgets, anchor detection keywords, topic fixation thresholds, compaction triggers, embedding model, archive retention days.

### Layer 10: Stability Plugin (`openclaw-plugin-stability`)

Runtime behavioral monitoring. Keeps agents grounded and self-aware.

**What it does:**
- **Entropy monitoring** — Tracks conversation entropy (0.0 = stable, 1.0+ = drifting). Injects `[STABILITY CONTEXT]` with current entropy score and principle alignment.
- **Principle alignment** — Reads `## Core Principles` from each agent's SOUL.md. Tracks positive/negative pattern matches per principle. Reports alignment status (stable/drifting/critical).
- **Loop detection** — Catches tool loops (5+ consecutive exec calls) and file re-reads (3+ reads of the same file). Injects warnings to break the pattern.
- **Heartbeat decision framework** — Structured decision logging for heartbeat polls. Tracks what was checked, what was decided, prevents redundant work.
- **Confabulation detection** — Flags temporal mismatches, quality decay, and recursive meta-reasoning.

**Data location:** `~/.openclaw/extensions/openclaw-plugin-stability/data/`
- `entropy-monitor.jsonl` — Entropy history log
- `entropy-history.json` — Aggregated entropy stats
- `investigation-state.json` — Investigation rate limiting

**Config:** Entropy thresholds, principle sources, loop detection limits, governance rate limits, quiet hours, detector toggles — all in `openclaw.plugin.json`.

### How Plugins Interact with the Memory Stack

```
                    RUNTIME (during conversation)
                    ┌─────────────────────────┐
                    │  Continuity Plugin       │
                    │  • topic tracking        │──→ [CONTINUITY CONTEXT] injected
                    │  • conversation archive  │      into every prompt
                    │  • semantic recall       │
                    ├─────────────────────────┤
                    │  Stability Plugin        │
                    │  • entropy monitoring    │──→ [STABILITY CONTEXT] injected
                    │  • principle alignment   │      into every prompt
                    │  • loop guards           │
                    └─────────────────────────┘
                              │
                    BOOT TIME (session start)
                    ┌─────────────────────────┐
                    │  File-based layers       │
                    │  • active-context.md     │
                    │  • MEMORY.md             │
                    │  • USER.md / SOUL.md     │
                    │  • project-{slug}.md     │
                    │  • facts.db              │
                    └─────────────────────────┘
```

The plugins don't replace the file-based layers — they augment them. File layers handle **what you know** (facts, decisions, context). Plugins handle **how you're performing** (drift, repetition, topic awareness, cross-session recall).

### Plugin Installation

Both plugins are installed as OpenClaw gateway extensions:

```bash
# Clone into extensions directory
cd ~/.openclaw/extensions
git clone https://github.com/CoderofTheWest/openclaw-plugin-continuity.git
git clone https://github.com/CoderofTheWest/openclaw-plugin-stability.git

# Install dependencies
cd openclaw-plugin-continuity && npm install
cd ../openclaw-plugin-stability && npm install

# Enable in config (~/.openclaw/openclaw.json)
# Add to plugins.entries:
#   "continuity": { "enabled": true }
#   "stability": { "enabled": true }

# Restart gateway
openclaw gateway restart
```

**Per-agent principles:** Add a `## Core Principles` section to each agent's SOUL.md for the stability plugin to track:

```markdown
## Core Principles
- **integrity** — investigate before asking, verify before claiming
- **directness** — no filler, no flattery, say what's true
- **reliability** — ship, don't talk about shipping
```

**Source:** [CoderofTheWest](https://github.com/CoderofTheWest) — community-built OpenClaw plugins.

## Embedding Options

| Provider | Cost | Latency | Quality | Setup |
|----------|------|---------|---------|-------|
| **Ollama nomic-embed-text** | Free | 61ms | Good | `ollama pull nomic-embed-text` |
| **QMD (built-in)** | Free | ~4s | Best (reranked) | Included with OpenClaw |
| **OpenAI text-embedding-3-small** | ~$0.02/M tokens | ~200ms | Great | API key required |

**Recommendation:** Start with Ollama for zero cost and full local control. QMD adds reranking quality if you can tolerate the latency.

### GPU Setup (AMD ROCm)

If you have an AMD GPU, use the `ollama/ollama:rocm` Docker image with device passthrough. See [`docs/embedding-setup.md`](docs/embedding-setup.md) for the full docker-compose with ROCm flags, group IDs, and environment variables.

**Pro tip:** Pin the embedding model permanently in VRAM for instant responses:
```bash
curl -s http://localhost:11434/api/generate \
  -d '{"model":"nomic-embed-text","keep_alive":-1}'
```

## Reference Hardware

This architecture is battle-tested on:

| Component | Spec |
|-----------|------|
| **CPU** | AMD Ryzen AI MAX+ 395 — 16c/32t |
| **RAM** | 32GB DDR5 (unified with GPU) |
| **GPU** | AMD Radeon 8060S — 40 CUs, 96GB unified VRAM |
| **Storage** | 1.9TB NVMe |
| **OS** | Ubuntu 25.10 |

The 96GB unified VRAM lets us run embedding models, rerankers, and large LLMs simultaneously without swapping. Smaller setups (8-16GB VRAM) work fine — just use Ollama alone without QMD, and don't pin too many models.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for detailed VRAM allocation breakdown and full hardware documentation.

## Semantic Code Search (Optional)

For codebase-aware agents, add [grepai](https://github.com/yoanbernabeu/grepai) — semantic code search using the same `nomic-embed-text` model. Search your code by meaning ("authentication logic") instead of text patterns.

```bash
grepai init && grepai watch &
grepai search "error handling patterns"
grepai trace callers "getAgents"
```

See [docs/code-search.md](docs/code-search.md) for full setup.

## Credits

This architecture was informed by:
- **David Badre** — *On Task: How the Brain Gets Things Done* (cognitive gating theory)
- **Shawn Harris** — [Building a Cognitive Architecture for Your OpenClaw Agent](https://shawnharris.com/building-a-cognitive-architecture-for-your-openclaw-agent/) (active-context.md, gating policies, runbooks)
- **r/openclaw community** — Hybrid SQLite+FTS5+vector memory approach (structured facts, memory decay, decision extraction)
- **CoderofTheWest** — [openclaw-plugin-continuity](https://github.com/CoderofTheWest/openclaw-plugin-continuity) and [openclaw-plugin-stability](https://github.com/CoderofTheWest/openclaw-plugin-stability) — runtime conversation archive, topic tracking, entropy monitoring, and principle alignment. Also discovered the [proprioceptive framing pattern](https://www.reddit.com/r/openclaw/comments/1r6rnq2/memory_fix_you_all_want/): identity docs must explicitly claim ownership of every memory system, or the agent won't use them
- Battle-tested on a production OpenClaw deployment managing 14 agents across multiple projects.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

MIT — use it, adapt it, share what you learn.
