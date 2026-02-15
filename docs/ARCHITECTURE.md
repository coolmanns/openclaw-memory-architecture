# Memory Architecture — Deep Dive

## Design Principles

1. **Gate aggressively, retrieve selectively.** Don't store everything; don't load everything.
2. **Right tool for the right query.** Structured lookups → SQLite. Fuzzy recall → embeddings.
3. **Externalize procedural knowledge.** Runbooks survive model switches; context windows don't.
4. **Learn from failures.** Every incident produces a numbered prevention rule.
5. **Working memory is sacred.** `active-context.md` stays under 2KB and always current.

## Query Routing

When the agent needs to recall something, route by query type:

| Query Pattern | Example | Route To | Latency |
|---------------|---------|----------|---------|
| Exact fact | "What's Alice's birthday?" | `facts.db` exact lookup | <1ms |
| Category browse | "What decisions have we made?" | `facts.db` category filter | <1ms |
| Keyword search | "anything about birthday" | `facts.db` FTS5 | <1ms |
| Fuzzy/contextual | "what were we discussing about infra?" | Semantic search (QMD/Ollama) | 60ms-5s |
| Current state | "what am I working on?" | `active-context.md` | Already loaded |
| Procedure | "how do I deploy to production?" | `tools-*.md` runbooks | File read |

## Consolidation Cycle

Information flows upward through curation:

```
1. Conversations happen → raw facts emerge
2. Daily logs capture events (memory/YYYY-MM-DD.md)
3. Structured facts extract to facts.db (auto or heartbeat)
4. Active items surface in active-context.md
5. Lessons distill into MEMORY.md
6. Failures crystallize into gating-policies.md
```

This happens naturally during:
- **Session end:** Update active-context.md
- **Heartbeat maintenance:** Review daily files → update MEMORY.md and facts.db
- **Failures:** Immediately add gating policy

## Embedding Architecture Options

### Option A: Fully Local (Recommended)

```
QMD (built-in) → primary search with reranking
Ollama nomic-embed-text → fallback when QMD times out
```

- Zero cost
- ~577MB VRAM for nomic-embed-text (pin permanently)
- QMD adds ~1.5GB on-demand for its 3 models

### Option B: Cloud Embeddings

```
OpenAI text-embedding-3-small → primary search
```

- ~$0.02/M tokens (negligible)
- ~200ms per call
- Requires API key and internet

### Option C: Hybrid

```
QMD → primary (local, reranked)
OpenAI → fallback (cloud, reliable)
```

Best quality, but adds cloud dependency.

## Memory Decay (Future Enhancement)

Not yet implemented, but the schema supports it via `last_accessed` and `access_count`:

| Tier | TTL | Refreshed On Access | Examples |
|------|-----|--------------------|---------| 
| Permanent | Never | N/A | Birthdays, core decisions |
| Stable | 90 days | Yes | Project details, relationships |
| Active | 14 days | Yes | Current tasks, sprint goals |
| Session | 24 hours | No | Debug context, temp state |
| Checkpoint | 4 hours | No | Pre-flight saves |

A background job could prune expired facts and log what was removed. The `access_count` field enables analysis of which facts are actually useful.

## Security Considerations

- **MEMORY.md** contains personal context — only load in main (private) sessions
- **facts.db** may contain credentials (reference pointers, not raw secrets)
- **Gating policies** may reference security-sensitive failure modes
- **Never expose** memory files in group chats, Discord, or shared contexts
- **Runbooks** with credentials should use environment variable references, not raw values

## Changelog

Track changes to your memory architecture here:

```
YYYY-MM-DD — Description of change and rationale
```
