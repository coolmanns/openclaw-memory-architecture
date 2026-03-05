# ADR-001: Replace Contemplation Plugin with Sub-Agent Reflection Loop

**Date:** 2026-02-22
**Status:** Accepted
**Deciders:** Sascha Kuhlmann, Gandalf

## Context

The OpenClaw metacognitive suite includes a **contemplation plugin** that captures knowledge gaps from metabolism and processes them through three LLM reflection passes spread over 24 hours (immediate → 4h → 20h). It also includes a **nightshift plugin** that schedules heavy LLM work for off-hours based on conversational cues ("good night" / "good morning") and clock-based windows.

We evaluated whether to install these alongside our existing stack (stability, continuity, metabolism).

## Research

- Read full source of both plugins and the metacognitive suite documentation
- Read the Clint identity transplant paper (origin story — agent autonomously designed these plugins)
- Reviewed cognitive science research on the incubation effect (temporal spacing in problem-solving)
- Analyzed our existing capabilities (sub-agents, cron, heartbeat)

## Decision

**Skip both plugins. Build a lightweight sub-agent reflection loop instead (deferred ~2 weeks).**

## Rationale

### Contemplation: Temporal Spacing vs. Thinking Depth

The contemplation plugin's 3-pass model runs on a local Ollama model (temperature 0.6, 700-token cap per pass). Its value proposition is temporal spacing — new context accumulates between passes.

However, **thinking depth is the actual quality lever, not temporal spacing.** A single sub-agent spawned with `thinking: "high"` on Opus produces deeper reasoning than three shallow local model passes. Extended thinking lets the model explore branches, reconsider, and backtrack — that's real cognitive depth, not simulated depth through repetition.

We can still get temporal spacing by running the reflection cron on a 4-6 hour interval. New conversations feed metabolism between cycles, so each processing round has fresh context. Best of both: deep thinking AND natural spacing.

### Nightshift: Solving a Constraint We Don't Have

Nightshift assumes the agent has one thread of execution and must time-share between user interaction and background work. Our architecture doesn't have this constraint:

- `sessions_spawn` fires isolated sub-agents on any model, any time
- Cron jobs run on exact schedules regardless of main agent activity
- Background exec handles local processing

Nightshift's best features (conversational triggers, interruptible processing, priority queue) are nice polish but not essential. Our heartbeat quiet hours (23:00-06:30) already handle the "don't bother Sascha at night" concern.

### The Planned Replacement

When metabolism has accumulated 2+ weeks of real conversational data:

1. Cron job scans growth vectors and knowledge gaps
2. Picks highest-value unprocessed items
3. Spawns sub-agent with `thinking: "high"` to reason deeply about them
4. Writes refined insights back to growth vectors or memory
5. Interval: every 4-6 hours, 1-2 items per run

This is simpler (a script + cron entry vs. a full plugin), higher quality (Opus with extended thinking vs. local 700-token skim), and uses infrastructure we already have.

### Why Deferred

Metabolism has been running < 24 hours. Current growth vectors are 50% about debugging metabolism itself — expected for day-one infrastructure work. Building the reflection loop now would optimize for noise. Let real signal accumulate first.

## Consequences

- No contemplation or nightshift plugins to maintain
- Knowledge gaps from metabolism currently fire into the void (no listener)
- Growth vectors accumulate but aren't revisited until the reflection loop is built
- Accepted risk: we may miss some gaps during the 2-week accumulation period
- Revisit this ADR if metabolism output quality suggests the plugin approach would be better

## Alternatives Considered

| Approach | Pros | Cons |
|----------|------|------|
| Install contemplation as-is | Zero build effort, proven | Shallow local model, 700-token cap, plugin complexity |
| Install contemplation + swap to cloud LLM | Better quality per pass | Still 24h for 3 passes, plugin overhead, config complexity |
| Sub-agent reflection loop (chosen) | Deep thinking, flexible timing, no plugin | Need to build it, deferred 2 weeks |
| Do nothing | Simplest | Growth vectors never get revisited |

## References

- [openclaw-metacognitive-suite](https://github.com/CoderofTheWest/openclaw-metacognitive-suite)
- [contemplation plugin source](https://github.com/CoderofTheWest/openclaw-plugin-contemplation)
- [nightshift plugin source](https://github.com/CoderofTheWest/openclaw-plugin-nightshift)
- [Clint identity transplant paper](https://github.com/CoderofTheWest/openclaw-metacognitive-suite/blob/main/clint-identity-transplant.md)
- Daily notes: `memory/2026-02-22.md`
