# Changelog

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
