# ADR-002: Growth Vector Refinement — Install Contemplation Plugin

**Date:** 2026-03-06
**Status:** Accepted (revised same day — switched from custom build to plugin install)
**Deciders:** Sascha Kuhlmann, Gandalf
**Supersedes:** ADR-001 (deferred implementation — now executing)

## Context

ADR-001 (2026-02-22) decided to skip the contemplation plugin and build a sub-agent reflection loop instead. The decision was to defer ~2 weeks until metabolism produced real signal. It's now been 12 days.

### Current State of Growth Vectors
- **340 candidates**, 0 promoted, 0 processed
- Vectors were reset on 2026-03-03 (noisy 1.0 distance threshold era → 0.85 threshold)
- Oldest candidate: ~3 days (post-reset)
- No consumer exists — metabolism writes, nothing reads
- Feedback file has 15 entries from stability's entropy-aware injection, but no refinement loop

### Pipeline Gap
```
Metabolism → extracts candidate growth vectors → ??? → nothing
Stability → injects top vectors into context → but vectors are unrefined noise
Crystallization → waits for 30-day validated vectors → none exist
```

## Decision

Build the sub-agent reflection loop as specified in ADR-001, with concrete implementation details.

## Architecture

### Three-Phase Processing

```
Phase 1: TRIAGE (every 4h via cron)
  - Scan unprocessed candidates
  - Fast LLM pass: classify as signal/noise/duplicate
  - Deduplicate (same insight appearing N times → merge, boost confidence)
  - Mark noise candidates as "dismissed"
  - Output: ranked list of signal candidates

Phase 2: REFLECT (every 6h via cron, after triage)
  - Pick top 2-3 signal candidates
  - Spawn sub-agent with thinking: "high" (Opus)
  - Deep analysis:
    - "Is this a real pattern or a one-off observation?"
    - "Does this connect to existing growth vectors?"
    - "What principle does this align with?" (integrity, directness, reliability, privacy, curiosity)
  - Output: refined growth vector with confidence score + principle alignment

Phase 3: PROMOTE (daily, 10 AM)
  - Vectors that survived triage + reflection
  - Confidence > 0.7 + principle alignment confirmed
  - Move from candidates → vectors array (status: "validated")
  - These become eligible for stability's context injection
  - After 30+ days validated → crystallization candidate
```

### Implementation Components

| Component | Type | Location | Model |
|-----------|------|----------|-------|
| `reflect-triage.sh` | Cron script | `~/clawd/scripts/` | Qwen3-4B (fast, local) |
| `reflect-deep.js` | Sub-agent spawner | `~/clawd/scripts/` | Opus (thinking: high) |
| `reflect-promote.sh` | Cron script | `~/clawd/scripts/` | None (rule-based) |

### Cron Schedule
```
# Triage: every 4 hours during waking hours
0 8,12,16,20 * * * ~/clawd/scripts/reflect-triage.sh >> ~/clawd/logs/reflection.log 2>&1

# Deep reflection: every 6 hours (offset from triage)
0 10,16,22 * * * ~/clawd/scripts/reflect-deep.js >> ~/clawd/logs/reflection.log 2>&1

# Promote: daily at 10 AM
0 10 * * * ~/clawd/scripts/reflect-promote.sh >> ~/clawd/logs/reflection.log 2>&1
```

### Safety Rails

1. **Read-only on first run** — triage script logs what it WOULD do, doesn't modify vectors until approved
2. **Candidate backup** — snapshot `growth-vectors.json` before any mutation
3. **Rate limit** — max 5 candidates processed per triage run, 3 per deep reflection
4. **Logging** — every action logged to `~/clawd/logs/reflection.log` with timestamps
5. **No auto-dismiss** — noise candidates marked "dismissed" but not deleted (recoverable)
6. **Human review** — promoted vectors surfaced in daily briefing for Sascha to review

### Data Flow

```
growth-vectors.json
  candidates[] ──┬── status: "unprocessed" (default)
                 ├── status: "signal" (after triage)
                 ├── status: "dismissed" (noise/duplicate)
                 ├── status: "reflecting" (during deep pass)
                 └── status: "refined" (after deep pass)

  vectors[] ──── status: "validated" (after promotion)
                 → eligible for stability injection
                 → eligible for crystallization after 30 days
```

### Integration with Existing Plugins

| Plugin | Integration Point |
|--------|------------------|
| **Metabolism** | Writes candidates (no change needed) |
| **Stability** | Already reads vectors[] for injection (no change needed) |
| **Crystallization** | Reads validated vectors >30 days old (install separately, Task #92) |
| **Continuity** | Refined vectors could feed facts.db (future enhancement) |

## Decision Revision (same day)

After building and running the triage script on all 343 candidates, Sascha observed:
1. We were rebuilding contemplation from scratch (triage=pass1, reflect=pass2, promote=pass3)
2. The closer we stay to CoderofTheWest's modules, the easier maintenance and upgrades
3. The triage run validated the concept — now install the real thing

**Revised decision: Install contemplation plugin, customize for our stack.**

### Pre-requisite: Fix Metabolism Data Quality
The 64% noise rate isn't a contemplation problem — it's a metabolism input problem. `_formatConversation()` feeds raw conversation INCLUDING `[CONTINUITY CONTEXT]`, `[STABILITY CONTEXT]`, sender JSON, and session metadata to the LLM. This metadata becomes growth vector text. Fix: strip context/stability/sender blocks before LLM extraction.

### Contemplation Plugin Customization
| Setting | Upstream Default | Our Config |
|---------|-----------------|------------|
| LLM endpoint | Local Ollama | llama.cpp :8084 (Qwen3-30B) |
| Token cap | 700 | 1500+ |
| Scheduling | Nightshift plugin | Cron (nightshift skipped) |
| Reasoning | Default | `--reasoning-format none` required for Qwen3 |
| Pass count | 3 over 24h | Keep (explore → reflect → synthesize) |

### What We Keep From This Session
- `reflect-triage.mjs` — useful as one-off cleanup tool and validation
- llama-metabolism infra changes: `-c 8192`, `--parallel 2`, `--reasoning-format none`
- Metabolism cron at `*/30` instead of `*/5`
- Triage results (343 candidates classified) — informs contemplation's starting state

## Consequences

- Growth vectors will finally have a consumer (contemplation plugin)
- Metabolism input quality improves (stripped metadata)
- Less custom code to maintain (plugin vs scripts)
- Crystallization pipeline will have material to work with (Task #92, after contemplation proven)
- Easier to track upstream updates from CoderofTheWest

## Rollout Plan (revised)

1. **Fix metabolism `_formatConversation()`** — strip context blocks
2. **Install contemplation plugin** — configure LLM, token cap, cron
3. **Test with existing 104 signal candidates** — verify 3-pass quality
4. **Install crystallization** (Task #92) — after contemplation proven

## Alternatives Considered

| Approach | Pros | Cons |
|----------|------|------|
| Install contemplation plugin (revised choice) | Pipeline exists, maintained upstream, crystallization integration | Need to customize LLM/scheduling |
| Custom sub-agent reflection (original choice) | Full control, Opus depth | Rebuilding existing plugin, more maintenance |
| Manual review only | Simplest | 340 candidates = not scalable |
| Reset and ignore | Cheapest | Waste metabolism compute, no learning loop |

## References

- ADR-001: `docs/adr/001-contemplation-replacement.md`
- Growth vectors file: `~/clawd/memory/growth-vectors.json`
- Stability vector injection: `~/.openclaw/extensions/openclaw-plugin-stability/lib/vectorStore.js`
- Metabolism candidate writing: `~/.openclaw/extensions/openclaw-plugin-metabolism/`
- Contemplation plugin: `https://github.com/CoderofTheWest/openclaw-plugin-contemplation`
- Crystallization plugin: `https://github.com/CoderofTheWest/openclaw-plugin-crystallization`
