# Memory Architecture — Gandalf's Cognitive System

> How memory works, why it's built this way, and how the pieces fit together.

## Overview

Gandalf's memory is a multi-layered system designed to survive session resets, context compaction, and model switches. No single layer handles everything — each serves a different query pattern and lifetime.

```
┌─────────────────────────────────────────────────────────┐
│                   SESSION CONTEXT                        │
│            (conversation + tool outputs)                  │
│                  ~200K token window                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│   │ active-      │  │  MEMORY.md   │  │  USER.md     │ │
│   │ context.md   │  │  (strategic) │  │  (identity)  │ │
│   │ (working     │  │              │  │              │ │
│   │  memory)     │  │  Long-term   │  │  Who Sascha  │ │
│   │              │  │  curated     │  │  is, family, │ │
│   │  What's hot  │  │  wisdom      │  │  projects    │ │
│   │  RIGHT NOW   │  │              │  │              │ │
│   └──────┬───────┘  └──────┬───────┘  └──────────────┘ │
│          │                 │                             │
│   ┌──────┴─────────────────┴──────────────────────────┐ │
│   │              SEMANTIC SEARCH                       │ │
│   │  QMD (embeddinggemma + qwen3-reranker) primary    │ │
│   │  Ollama nomic-embed-text (768d) fallback          │ │
│   │  572 chunks / 155 documents indexed               │ │
│   └──────┬─────────────────┬──────────────────────────┘ │
│          │                 │                             │
│   ┌──────┴───────┐  ┌─────┴────────┐  ┌─────────────┐ │
│   │ facts.db     │  │ YYYY-MM-DD   │  │ tools-*.md  │ │
│   │ (structured) │  │ .md (daily)  │  │ (procedural)│ │
│   │              │  │              │  │             │ │
│   │ Entity/key/  │  │ Raw session  │  │ Runbooks,   │ │
│   │ value lookup │  │ logs, what   │  │ API creds,  │ │
│   │              │  │ happened     │  │ how-to      │ │
│   └──────────────┘  └──────────────┘  └─────────────┘ │
│                                                          │
│   ┌──────────────────────────────────────────────────┐  │
│   │            PROJECT MEMORY (NEW)                   │  │
│   │  memory/project-{slug}.md per project             │  │
│   │                                                    │  │
│   │  Agent-independent institutional knowledge:        │  │
│   │  decisions, lessons, conventions, risks             │  │
│   │  Created by wizard · Read by all agents at boot    │  │
│   │  Updated by PM at phase close                      │  │
│   └──────────────────────────────────────────────────┘  │
│                                                          │
├─────────────────────────────────────────────────────────┤
│   ┌──────────────┐  ┌──────────────┐                    │
│   │ gating-      │  │ checkpoints/ │                    │
│   │ policies.md  │  │ (pre-flight) │                    │
│   │              │  │              │                    │
│   │ Failure      │  │ State saves  │                    │
│   │ prevention   │  │ before risky │                    │
│   │ rules        │  │ operations   │                    │
│   └──────────────┘  └──────────────┘                    │
├─────────────────────────────────────────────────────────┤
│             RUNTIME PLUGIN LAYERS (v3)                   │
├─────────────────────────────────────────────────────────┤
│   ┌──────────────────────────────────────────────────┐  │
│   │ CONTINUITY PLUGIN                                 │  │
│   │ Cross-session archive (SQLite + SQLite-vec)       │  │
│   │ 384d embeddings (all-MiniLM-L6-v2)               │  │
│   │ Topic tracking · Continuity anchors               │  │
│   │ Context budgeting · Priority-tiered compaction     │  │
│   │ Injects: [CONTINUITY CONTEXT] per prompt          │  │
│   └──────────────────────────────────────────────────┘  │
│   ┌──────────────────────────────────────────────────┐  │
│   │ STABILITY PLUGIN                                  │  │
│   │ Entropy monitoring (0.0 stable → 1.0+ drift)     │  │
│   │ Principle alignment (from SOUL.md Core Principles)│  │
│   │ Loop detection · Confabulation detection           │  │
│   │ Heartbeat decision framework                       │  │
│   │ Injects: [STABILITY CONTEXT] per prompt           │  │
│   └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Layers

### Layer 1: Always-Loaded Context

**Files loaded every session start, no questions asked.**

| File | Purpose | Size Target | Update Frequency |
|------|---------|-------------|-----------------|
| `SOUL.md` | Who I am — identity, voice, values | <2KB | Rarely (with Sascha's knowledge) |
| `USER.md` | Who Sascha is — family, projects, preferences | <3KB | When new info learned |
| `IDENTITY.md` | Quick identity card (name, emoji, vibe) | <0.5KB | Rarely |
| `memory/active-context.md` | Working memory — what's hot right now | <2KB | End of every significant session |
| `HEARTBEAT.md` | Periodic check instructions | <1KB | As needed |

**Token budget:** ~2,000 tokens total for always-loaded files. Keep them lean.

### Layer 2: Strategic Memory (MEMORY.md — Main Session Only)

| File | Purpose | Size Target | Update Frequency |
|------|---------|-------------|-----------------|
| `MEMORY.md` | Long-term curated wisdom — lessons, insights, key events | <8KB | During heartbeat memory maintenance |

**Rules:**
- Only loaded in main session (direct chat with Sascha)
- Never loaded in shared contexts (Discord, group chats) — security
- Reviewed and pruned every few days during heartbeat maintenance
- Daily files get distilled into MEMORY.md, not dumped wholesale

### Layer 3: Project Memory (Cross-Agent, Per-Project)

**`memory/project-{slug}.md`** — Institutional knowledge per project.

| File | Purpose | Size Target | Update Frequency |
|------|---------|-------------|-----------------|
| `memory/project-clawsmith.md` | ClawSmith decisions, lessons, conventions, risks | <6KB | At every phase close |
| `memory/project-adult-in-training.md` | AIT legal rails, content pipeline, brand voice | <3KB | When workflow changes |

**What goes here:**
- Architecture decisions (distilled, not raw DB dumps)
- Lessons learned the hard way — agent management, infrastructure, process
- Conventions that emerged during development
- Known risks and active concerns
- Workflow patterns (status flow, QA process, design-first rules)

**What does NOT go here:**
- Backlog items, current status, sprint state → that's the DB
- Raw daily logs → that's `YYYY-MM-DD.md`
- Personal context → that's `MEMORY.md` or `USER.md`

**Lifecycle:**
1. **Created** by Project Setup Wizard (`/api/projects/create` auto-scaffolds the template)
2. **Seeded** by the wizard agent with initial context from the setup conversation
3. **Read** by all project agents at boot (step 1 in every agent's boot sequence)
4. **Updated** by PM at phase close gate (D-012) — retrospective findings, new lessons, convention changes
5. **Survives** every agent reset, compaction, and session purge

**Key property:** Agent-independent. When Toby resets, the knowledge persists. When Pete compacts, decisions don't vanish. One file per project, maintained centrally, read by everyone.

**Rules:**
- All project agents read this at session start — it's step 1 in boot sequence
- PM is responsible for keeping it current (phase close gate enforces this)
- Main agent (Gandalf) can also update it when significant cross-cutting decisions happen
- Keep it under 6KB — distilled wisdom, not a dump of everything

### Layer 4: Structured Facts (SQLite)

**`memory/facts.db`** — Entity/key/value store for precise lookups.

```sql
CREATE TABLE facts (
    id INTEGER PRIMARY KEY,
    entity TEXT NOT NULL,      -- "Janna", "ClawSmith", "convention"
    key TEXT NOT NULL,         -- "birthday", "stack", "always"
    value TEXT NOT NULL,       -- "July 7", "Next.js 15 + SQLite", "use trash not rm"
    category TEXT NOT NULL,    -- person, project, decision, convention, credential, preference
    source TEXT,               -- "conversation 2026-02-14", "USER.md"
    created_at TEXT NOT NULL,
    last_accessed TEXT,        -- TTL refresh: updated on every retrieval
    access_count INTEGER DEFAULT 0,
    permanent BOOLEAN DEFAULT 0  -- 1 = never decays
);
CREATE INDEX idx_facts_entity ON facts(entity);
CREATE INDEX idx_facts_category ON facts(category);
CREATE VIRTUAL TABLE facts_fts USING fts5(entity, key, value, content=facts, content_rowid=id);
```

**Query patterns:**
- `SELECT * FROM facts WHERE entity='Janna' AND key='birthday'` → instant, exact
- `SELECT * FROM facts_fts WHERE facts_fts MATCH 'birthday'` → full-text search
- Semantic search (QMD/Ollama) for fuzzy "what was that thing about..." queries

**Categories:**
| Category | Examples | Permanent? |
|----------|----------|-----------|
| `person` | Names, birthdays, relationships | Yes |
| `project` | Stack, URLs, status | No (90-day refresh) |
| `decision` | "We chose X because Y" | Yes |
| `convention` | "Always use trash, not rm" | Yes |
| `credential` | API keys, endpoints (reference only) | Yes |
| `preference` | "Prefers dark mode", "hates sycophancy" | Yes |

### Layer 5: Semantic Search

Two-tier search with automatic fallback:

**Primary: QMD**
- Backend: embeddinggemma-300M (embedding) + qwen3-reranker-0.6b (reranking) + Qwen3-0.6B (query expansion)
- 572 chunks from 155 documents
- Timeout: 5000ms
- Strengths: Reranking produces high-quality results, query expansion finds related concepts
- Weakness: 3 local models competing for VRAM, ~4s latency

**Fallback: Ollama nomic-embed-text**
- 768-dimension vectors, 61ms warm response
- 577MB VRAM (pinned permanently, keep_alive: -1)
- Pure cosine similarity — no reranking
- Activates when QMD times out (which is ~50% of queries)

**Config location:** `memorySearch` in `~/.openclaw/openclaw.json`

```json
{
  "memorySearch": {
    "backend": "qmd",
    "qmd": {
      "limits": { "timeoutMs": 5000, "maxResults": 6 }
    }
  },
  "agents": {
    "defaults": {
      "memorySearch": {
        "enabled": true,
        "provider": "openai",
        "remote": { "baseUrl": "http://localhost:11434/v1", "apiKey": "ollama" },
        "fallback": "none",
        "model": "nomic-embed-text"
      }
    }
  }
}
```

### Layer 6: Daily Logs (Tactical)

**`memory/YYYY-MM-DD.md`** — Raw session logs. What happened today.

- Created per day, appended to (never overwritten)
- Contains: decisions made, bugs fixed, conversations had, things learned
- Source material for MEMORY.md curation and facts extraction
- Loaded on demand via `memory_search`, not injected into context

### Layer 7: Procedural Memory (Runbooks)

**`memory/tools-*.md`** and **`TOOLS.md`** — How to do things.

- `tools-wix-api.md` — Wix API credentials, endpoints, blog publish workflow
- `tools-home-assistant.md` — HA entities, automations
- `tools-social-media.md` — Postiz API, content pipeline
- `tools-infrastructure.md` — Komodo, Ghost, goplaces, khal, reMarkable
- `tools-n8n.md` — n8n workflows

**Rule:** If a task requires multi-step tool use, it should have a runbook in `memory/tools-*.md`. When a task has a runbook, read it before executing.

### Layer 8: Gating Policies

**`memory/gating-policies.md`** — Numbered failure prevention rules.

Each policy emerged from an actual failure. Format:
```
GP-XXX | Trigger | Action | Reason (what went wrong)
```

### Layer 9: Pre-Flight Checkpoints

**`memory/checkpoints/`** — State saves before risky operations.

- Created before: config changes, multi-file refactors, deployments, bulk updates
- Contains: what I'm about to do, current state, expected outcome, rollback plan
- Auto-expire: deleted after 4 hours (or on successful completion)
- Purpose: survive compaction mid-task

### Layer 10: Continuity Plugin (Runtime)

**`openclaw-plugin-continuity`** — Cross-session conversation memory.

Unlike the file-based layers (loaded at boot), this plugin operates **during** the conversation — tracking, archiving, and recalling in real time.

| Component | Purpose | Storage |
|-----------|---------|---------|
| Conversation archive | Stores all exchanges with embeddings | SQLite + SQLite-vec (384d) |
| Topic tracking | Detects active, fixated, and fading topics | In-memory, injected per prompt |
| Continuity anchors | Preserves identity moments and contradictions | In-memory, max 15, 2h TTL |
| Context budgeting | Priority-tiered token allocation for compaction | Configurable pool ratios |
| Semantic search | "What did we talk about last week?" | SQLite-vec cosine similarity |

**Prompt injection:** Every prompt receives a `[CONTINUITY CONTEXT]` block:
```
[CONTINUITY CONTEXT]
Session: 8 exchanges | Started: 25min ago
Topics: keystone (active), plugins (fixated — 5 mentions), memory (active)
```

**Data:** `~/.openclaw/extensions/openclaw-plugin-continuity/data/continuity.db`

**Key config options:**
- `contextBudget.recentTurnsAlwaysFull: 5` — last 5 turns never truncated
- `topicTracking.fixationThreshold: 3` — mentions before a topic is flagged as fixated
- `archive.retentionDays: 90` — how long archived conversations are kept
- `embedding.model: "Xenova/all-MiniLM-L6-v2"` — local embedding model (384 dimensions)

### Layer 11: Stability Plugin (Runtime)

**`openclaw-plugin-stability`** — Behavioral monitoring and drift prevention.

| Component | Purpose | Storage |
|-----------|---------|---------|
| Entropy monitor | Tracks conversation coherence (0.0–1.0+) | JSONL log file |
| Principle alignment | Matches behavior against SOUL.md principles | Per-prompt evaluation |
| Loop detection | Catches tool loops and file re-reads | In-memory counters |
| Heartbeat decisions | Structured decision logging for heartbeats | In-memory + log |
| Confabulation detection | Flags temporal mismatches and quality decay | Per-prompt evaluation |

**Prompt injection:** Every prompt receives a `[STABILITY CONTEXT]` block:
```
[STABILITY CONTEXT]
Entropy: 0.20 (nominal)
Principles: integrity, directness, reliability, privacy, curiosity | Alignment: stable
```

**Per-agent principles:** Each agent's SOUL.md can define a `## Core Principles` section with custom principles. The plugin extracts these at boot and tracks alignment throughout the session. Agents without custom principles get defaults.

**Data:** `~/.openclaw/extensions/openclaw-plugin-stability/data/`

**Key config options:**
- `entropy.warningThreshold: 0.8` — entropy level that triggers a warning
- `entropy.criticalThreshold: 1.0` — entropy level that triggers grounding
- `loopDetection.consecutiveToolThreshold: 5` — consecutive tool calls before warning
- `loopDetection.fileRereadThreshold: 3` — re-reads of same file before warning
- `governance.quietHours: { start: "22:00", end: "07:00" }` — reduced activity window

**Source:** Both plugins by [CoderofTheWest](https://github.com/CoderofTheWest)

---

## Information Flow

### Upward (Consolidation)
```
Daily logs → active-context.md → MEMORY.md → facts.db
(raw)        (working memory)    (curated)   (structured)

Session work → phase close → project-{slug}.md
(ephemeral)   (PM gate)      (institutional)
```

- Daily logs capture everything
- Significant items promote to active-context.md
- Lessons and insights promote to MEMORY.md during heartbeat maintenance
- Precise facts extract to facts.db (auto or manual)
- **Project lessons consolidate to `project-{slug}.md` at every phase close** — PM-enforced gate

### Downward (Decomposition)
```
Goals → Tasks → Actions → Checkpoints
(MEMORY.md) → (active-context.md) → (session) → (checkpoints/)
```

### Cross-Agent Flow (Project Memory)
```
Wizard creates project → seeds project-{slug}.md
                              ↓
All project agents read at boot (step 1)
                              ↓
Agents work, learn things, make decisions
                              ↓
PM consolidates at phase close → updates project-{slug}.md
                              ↓
Next reset/compaction → agents boot with institutional knowledge intact
```

This is the key difference from agent-scoped memory: project memory is **agent-independent**.
Toby resets? Knowledge persists. Pete compacts? Decisions survive. New agent joins? Reads one file, knows everything.

### Session Boot Sequence

**Main agent (Gandalf):**
```
1. Read SOUL.md (who am I)
2. Read USER.md (who am I helping)
3. Read memory/active-context.md (what's hot)
4. Read memory/YYYY-MM-DD.md (today + yesterday)
5. Read MEMORY.md
6. [On demand] memory_search for specific recalls
7. [On demand] facts.db for structured lookups
```

**Project agents (Toby, Pete, Beta-tester, etc.):**
```
1. Read memory/project-{slug}.md (institutional knowledge — FIRST)
2. Read SOUL.md / IDENTITY.md (who am I)
3. Read agent-specific boot steps (clawsmith-cli state, work queue, etc.)
4. Read memory/YYYY-MM-DD.md (today) for recent context
```

---

## Embedding Infrastructure

| Component | Model | Size | VRAM | Latency | Purpose |
|-----------|-------|------|------|---------|---------|
| QMD embedding | embeddinggemma-300M-Q8_0 | ~300MB | Shared | ~20s/572 chunks | Index building |
| QMD reranker | qwen3-reranker-0.6b-q8_0 | ~600MB | Shared | ~2s | Result reranking |
| QMD expansion | Qwen3-0.6B-Q8_0 | ~600MB | Shared | ~1s | Query expansion |
| Ollama fallback | nomic-embed-text:F16 | 274MB disk | 577MB (pinned) | 61ms warm | Fallback search |

**Total VRAM for memory:** ~577MB pinned (nomic) + ~1.5GB on-demand (QMD models)

**Key constraint:** nomic-embed-text produces 768d vectors, incompatible with OpenAI's 1536d. Switching embedding models requires full re-index.

### Hardware (aiserver)

| Component | Spec |
|-----------|------|
| **CPU** | AMD Ryzen AI MAX+ 395 — 16 cores / 32 threads |
| **RAM** | 32GB DDR5 (shared with GPU — unified memory architecture) |
| **GPU** | AMD Radeon 8060S (integrated) — 40 CUs, **96GB VRAM** (unified) |
| **NPU** | RyzenAI NPU5 (not currently used) |
| **Storage** | 1.9TB NVMe (Phison ESR02T) — 12% used |
| **OS** | Ubuntu 25.10 |
| **Hostname** | aiserver.home.mykuhlmann.com |

**Key advantage:** 96GB unified VRAM means we can run large models (70B+) that would require multi-GPU setups on discrete cards. The tradeoff is shared memory bandwidth with system RAM.

**Current VRAM allocation:**
- ~577MB pinned: nomic-embed-text (embedding model, always loaded)
- ~1.5GB on-demand: QMD models (embeddinggemma + qwen3-reranker + Qwen3-0.6B)
- Rest available for LLM inference (Ollama `OLLAMA_GPU_MEMORY: 96GB`)

### Ollama Setup (AMD ROCm GPU)

**Hardware:** AMD GPU (RX 7900 XTX class) with ROCm support.

**Docker Compose** (`~/projects/ollama/docker-compose.yml`):
```yaml
services:
  ollama:
    image: ollama/ollama:rocm          # <-- ROCm variant, NOT the default image
    container_name: ollama
    restart: unless-stopped
    ports:
      - "11434:11434"
    volumes:
      - /home/coolmann/.ollama:/root/.ollama
    devices:                            # AMD GPU passthrough
      - /dev/kfd:/dev/kfd
      - /dev/dri:/dev/dri
    group_add:
      - "993"                           # render group GID
      - "44"                            # video group GID
    environment:
      HIP_VISIBLE_DEVICES: "0"          # GPU index (multi-GPU: "0,1")
      OLLAMA_FLASH_ATTENTION: "1"       # enable flash attention
      OLLAMA_GPU_MEMORY: "96GB"         # total GPU memory budget
      OLLAMA_MAX_LOADED_MODELS: "2"     # max concurrent models in VRAM
      OLLAMA_NUM_PARALLEL: "2"          # parallel request handling
      # Uncomment for unsupported cards:
      # HSA_OVERRIDE_GFX_VERSION: "10.3.0"
```

**Critical notes:**
- Must use `ollama/ollama:rocm` image — the default `ollama/ollama` has no AMD GPU support
- `/dev/kfd` and `/dev/dri` device passthrough is required for GPU access
- Group IDs (993, 44) must match your host's `render` and `video` groups — check with `getent group render video`
- `OLLAMA_FLASH_ATTENTION=1` significantly improves throughput on supported models

### Embedding Model Configuration

**Model:** `nomic-embed-text` (137M params, F16 quantization, nomic-bert family)
- 768-dimension vectors, 2048 context length
- Chosen over alternatives: qwen3-embedding (26GB VRAM, too large), OpenAI text-embedding-3-small (external API cost)

**Pin model permanently in VRAM** (prevents cold-start latency):
```bash
# Load model with infinite keep-alive — survives between requests
curl -s http://localhost:11434/api/generate \
  -d '{"model": "nomic-embed-text", "keep_alive": -1}'
```
- `keep_alive: -1` = never unload from VRAM
- Result: 61ms warm response vs ~3s cold load
- VRAM cost: 577MB permanently allocated
- Verify with: `curl -s http://localhost:11434/api/ps` — should show `expires_at` far in the future

**Pull the model:**
```bash
docker exec ollama ollama pull nomic-embed-text
```

### OpenClaw Memory Search Configuration

In `~/.openclaw/openclaw.json`:
```json
{
  "memorySearch": {
    "backend": "qmd",
    "qmd": {
      "limits": { "timeoutMs": 5000, "maxResults": 6 }
    }
  },
  "agents": {
    "defaults": {
      "memorySearch": {
        "enabled": true,
        "provider": "openai",
        "remote": {
          "baseUrl": "http://localhost:11434/v1",
          "apiKey": "ollama"
        },
        "fallback": "none",
        "model": "nomic-embed-text"
      }
    }
  }
}
```

**How it works:**
- Primary: QMD (local reranking engine) — best quality, ~4s latency, sometimes times out
- Fallback: Ollama nomic-embed-text via OpenAI-compatible API — fast (61ms), always available
- `provider: "openai"` with `baseUrl` pointing to Ollama — uses Ollama's OpenAI-compatible endpoint
- `apiKey: "ollama"` — required by the client but Ollama ignores it

---

## Implementation Patterns

### Pattern: Proprioceptive Framing

**Problem:** An agent has access to a database, can query it with tools, and receives injected context from a plugin — but when asked about past conversations, denies having access.

**Root cause:** Identity documents (AGENTS.md, SOUL.md) define memory as *only files*:
- "You wake up fresh each session. **These files** are your continuity."
- "Memory is limited — if you want to remember something, **WRITE IT TO A FILE.**"

This creates a semantic frame where databases exist as "external infrastructure" rather than "my memory." The agent has the capability but not the proprioceptive ownership.

**Fix:** Explicitly list every memory system in the identity documents as belonging to the agent:

```markdown
## Memory
You wake up fresh each session. These are your memory systems:
- **Daily notes:** `memory/YYYY-MM-DD.md` — raw logs
- **Long-term:** `MEMORY.md` — curated memories
- **Structured facts:** `memory/facts.db` — entity/key/value SQLite store
- **Conversation archive:** continuity.db — past exchanges, queryable via sqlite3
- **Continuity plugin:** Actively injecting relevant past exchanges into your context

**Don't claim "I don't have access to X" until you've checked all systems.**
```

**Key insight:** The bottleneck isn't technical — it's the frame. Same binary, same data, different proprioceptive ownership. Two paragraphs in AGENTS.md shift a database from "external system" to "my memory system."

**Credit:** Discovered by [CoderofTheWest](https://github.com/CoderofTheWest) while building the CLINT agent wrapper. Documented in [r/openclaw](https://www.reddit.com/r/openclaw/comments/1r6rnq2/memory_fix_you_all_want/).

**Rule of thumb:** When adding a new memory layer (plugin, database, API), always update the agent's identity documents to claim ownership of it. If the identity docs don't say "this is mine," the agent won't use it consistently.

---

## Changelog

### 2026-02-17 — Proprioceptive Framing Fix + Four Memory Systems
- **Added** "Implementation Patterns" section with Proprioceptive Framing pattern
- **Changed** AGENTS.md memory section — explicitly lists all four memory systems (files, facts.db, continuity.db, plugin injection)
- **Changed** framing from "These files are your continuity" to "These are your memory systems"
- **Added** rule: "Don't claim 'I don't have access to X' until you've checked all four"
- **Credit** CoderofTheWest (r/openclaw) for discovering the framing-as-bottleneck pattern
- **Rationale:** Identity documents defining memory as "only files" caused the agent to ignore SQLite databases and plugin-injected context, even when the tools existed and data was present. The fix is proprioceptive: claim ownership in the identity docs.

### 2026-02-15b — Project Memory Layer (Cross-Agent Knowledge)
- **Added** `memory/project-{slug}.md` — per-project institutional knowledge files
- **Created** `memory/project-clawsmith.md` (~6KB) — 16 architecture decisions, 15 lessons, conventions, risks
- **Created** `memory/project-adult-in-training.md` (~2.5KB) — legal rails, content pipeline, brand voice
- **Changed** `/api/projects/create` scaffold — now auto-creates `memory/project-{slug}.md` template
- **Changed** Project Setup Wizard boot sequence — steps 6-7: populate project memory, wire agent boot sequences
- **Changed** Pete PM phase close gate (D-012) — must update project memory before closing phase
- **Changed** Agent boot sequences (Toby, Pete, Beta-tester) — step 1 is now reading project memory
- **Rationale:** Agent resets and compaction destroyed project knowledge. Decisions vanished, lessons had to be relearned. Project memory is agent-independent — one file per project, maintained by PM at phase close, read by all agents at boot. Solves the "Toby resets and starts from zero" problem.

### 2026-02-15 — Memory Architecture v2 (Hybrid System)
- **Added** `memory/active-context.md` — working memory scratchpad
- **Added** `memory/facts.db` — SQLite + FTS5 structured facts store
- **Added** `memory/gating-policies.md` — numbered failure prevention rules
- **Added** `memory/checkpoints/` — pre-flight state saves
- **Added** `memory/ARCHITECTURE.md` — this document
- **Changed** QMD timeout from 4000ms to 5000ms
- **Rationale:** Inspired by Shawn Harris (cognitive architecture article) and Reddit hybrid memory post. 80% of memory queries are structured lookups — embedding search is overkill for "what's Janna's birthday?"

### 2026-02-14 — Local Embeddings Migration
- **Changed** memory search from OpenAI text-embedding-3-small to local Ollama nomic-embed-text
- **Removed** qwen3-embedding:8b-fp16 (26GB VRAM, too slow)
- **Added** nomic-embed-text pinned permanently in VRAM (577MB, keep_alive: -1)
- **Added** QMD index: 572 chunks from 155 documents
- **Rationale:** Zero cost, fully local, 61ms response. Quality comparable to OpenAI for memory search use case.

### 2026-02-12 — QMD Memory Search Enabled
- **Added** QMD as primary memory search backend
- **Added** Ollama nomic-embed-text as fallback when QMD times out
- **Added** `memorySearch.enabled: true` globally for all agents
- **Rationale:** Agents need memory continuity across sessions. QMD provides reranked results; Ollama provides fast fallback.

### 2026-02-05 — Foundation
- **Created** `MEMORY.md` — long-term curated memory
- **Created** `memory/YYYY-MM-DD.md` pattern — daily logs
- **Created** `USER.md` — human identity file
- **Created** `SOUL.md` — agent identity file
- **Rationale:** Basic memory system following OpenClaw defaults.
