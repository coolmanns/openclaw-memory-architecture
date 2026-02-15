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
│  ┌──────────────┐  ┌──────────────┐                  │
│  │ tools-*.md   │  │ checkpoints/ │                  │
│  │ (runbooks)   │  │ (pre-flight) │                  │
│  └──────────────┘  └──────────────┘                  │
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

### Layer 2: Structured Facts (SQLite + FTS5)
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

### Layer 3: Semantic Search
For fuzzy recall where keywords don't match but meaning does. Works with:
- **QMD** (OpenClaw's built-in) — reranking + query expansion
- **Ollama** (local embeddings) — zero cost, 61ms
- **OpenAI** (cloud) — higher quality, per-call cost

### Layer 4: Daily Logs
`memory/YYYY-MM-DD.md` — raw session logs. What happened today. Source material for curation.

### Layer 5: Gating Policies
Numbered failure prevention rules learned from actual mistakes:

```
GP-001 | Before config.patch on arrays | Read current, modify in full | Partial array patch nuked all agents
GP-004 | Before stating any date/time  | Run TZ command first         | Timezone mistakes from mental math
```

### Layer 6: Pre-Flight Checkpoints
State saves before risky operations. If compaction hits mid-task, checkpoints survive.

### Layer 7: Procedural Memory (Runbooks)
`tools-*.md` files documenting HOW to do things — API endpoints, auth flows, multi-step procedures. Survives model switches and compaction.

## Information Flow

### Upward (Consolidation)
```
Daily logs → active-context.md → MEMORY.md → facts.db
(raw)        (working memory)    (curated)   (structured)
```

### Session Boot Sequence
```
1. Read SOUL.md (who am I)
2. Read USER.md (who am I helping)
3. Read active-context.md (what's hot)
4. Read today's + yesterday's daily log
5. [Main session only] Read MEMORY.md
6. [On demand] Semantic search for specific recalls
7. [On demand] facts.db for structured lookups
8. [If risky task] Check gating-policies.md
```

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

## Embedding Options

| Provider | Cost | Latency | Quality | Setup |
|----------|------|---------|---------|-------|
| **Ollama nomic-embed-text** | Free | 61ms | Good | `ollama pull nomic-embed-text` |
| **QMD (built-in)** | Free | ~4s | Best (reranked) | Included with OpenClaw |
| **OpenAI text-embedding-3-small** | ~$0.02/M tokens | ~200ms | Great | API key required |

**Recommendation:** Start with Ollama for zero cost and full local control. QMD adds reranking quality if you can tolerate the latency.

## Credits

This architecture was informed by:
- **David Badre** — *On Task: How the Brain Gets Things Done* (cognitive gating theory)
- **Shawn Harris** — [Building a Cognitive Architecture for Your OpenClaw Agent](https://shawnharris.com/building-a-cognitive-architecture-for-your-openclaw-agent/) (active-context.md, gating policies, runbooks)
- **r/openclaw community** — Hybrid SQLite+FTS5+vector memory approach (structured facts, memory decay, decision extraction)
- Battle-tested on a production OpenClaw deployment managing 11 agents across multiple projects.

## License

MIT — use it, adapt it, share what you learn.
