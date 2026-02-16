# Changelog

## v2.1 — 2026-02-16

### Added
- **Importance tagging for daily logs** — tiered retention system with five tag types (`decision`, `milestone`, `lesson`, `task`, `context`) and importance scores controlling auto-pruning
- **Auto-pruning script** — `scripts/prune-memory.py` enforces retention tiers (STRUCTURAL permanent, POTENTIAL 30d, CONTEXTUAL 7d) with `--dry-run` support
- **SLEEP session lifecycle** — the other half of Wake/Sleep: active-context update, tagged observations, MEMORY.md distillation before session end or compaction
- **Memory maintenance via heartbeats** — periodic consolidation: review daily files, update MEMORY.md, prune stale info, cross-check USER.md for missed personal details
- **USER.md maintenance pattern** — explicit guidance on keeping your human's profile current
- **5 battle-tested gating policies** (GP-008 through GP-012):
  - GP-008: Full-array replacement for config.patch (partial patch destroys lists)
  - GP-009: Read active-context.md after model/session switch
  - GP-010: Update USER.md immediately when learning about your human
  - GP-011: Re-embed entire index after embedding model changes
  - GP-012: Run writing quality pipeline before publishing

### Changed
- `README.md` — Layer 4 (Daily Logs) expanded with importance tagging reference, retention tiers, and auto-pruning docs; Session Boot Sequence now includes SLEEP lifecycle
- `templates/agents-memory-section.md` — renamed "Boot Sequence" to "Wake/Sleep Pattern", added SLEEP phase with importance tags, added Memory Maintenance section, added USER.md section
- `templates/gating-policies.md` — 5 new real-world policies from production failures

## v2.0 — 2026-02-15

### Added
- **Layer 2.5: Project Memory** — per-project institutional knowledge files (`memory/project-{slug}.md`)
  - Agent-independent: survives resets, compaction, session purges
  - Created by Project Setup Wizard, read by all project agents at boot, updated by PM at phase close
  - Template: `templates/project-memory.md`
- **Hardware documentation** — full specs for our reference deployment (AMD Ryzen AI MAX+ 395, 96GB unified VRAM)
- **AMD ROCm docker-compose** — complete Ollama GPU setup with device passthrough, group IDs, environment flags
- **Embedding model pinning** — how to keep nomic-embed-text permanently in VRAM with `keep_alive: -1`
- **Cross-agent flow diagrams** — how knowledge flows from wizard → agents → phase close → next boot
- **Split boot sequences** — separate docs for main agent vs project agents

### Changed
- `docs/ARCHITECTURE.md` — major expansion (102 → 475 lines)
- `docs/embedding-setup.md` — added ROCm docker-compose section with all flags documented
- Diagram updated with project memory layer between strategic memory and structured facts

## v1.1 — 2026-02-14

### Added
- Semantic code search layer via grepai integration
- `docs/code-search.md` — setup and usage guide

## v1.0 — 2026-02-14

### Added
- Initial release: 8-layer memory architecture
- `docs/ARCHITECTURE.md` — full architecture documentation
- `docs/embedding-setup.md` — Ollama, QMD, and OpenAI embedding options
- `schema/facts.sql` — SQLite + FTS5 schema for structured facts
- `scripts/init-facts-db.py`, `seed-facts.py`, `query-facts.py`
- `templates/` — active-context.md, gating-policies.md, agents-memory-section.md
