# Gating Policies — Failure Prevention Rules

> Each policy emerged from an actual failure. When the trigger condition matches, follow the action. No exceptions.
> When something goes wrong, add a new policy in the same turn.

| ID | Trigger | Action | Failure That Caused This |
|----|---------|--------|--------------------------|
| GP-001 | Before destructive file operations | Use `trash` instead of `rm` — recoverable beats gone forever | General safety principle |
| GP-002 | Before stating any date/time/day | Run timezone-aware date command first. Never do mental math. | Timezone mistakes from mental arithmetic |
| GP-003 | After creating cron jobs | Verify with `cron list`, store job IDs in active-context.md | Cron jobs created but IDs not recorded — no management possible |
| GP-004 | After model/session switch | Read active-context.md immediately — it has your operational state | Context loss on compaction/session reset |
| GP-005 | Before multi-step risky operations | Create pre-flight checkpoint in `memory/checkpoints/` | Compaction mid-task causes amnesia |
| GP-006 | When learning new facts about your human | Update USER.md in the same turn. Don't wait. | Personal details lost when not captured immediately |
| GP-007 | Before sending anything externally | Get explicit approval from your human | Standing safety rule — nothing goes public without green light |

<!-- Add new policies below as failures occur -->
