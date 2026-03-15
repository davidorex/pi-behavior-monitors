# Changelog

All notable changes to this project will be documented in this file.

## v0.1.0

Initial release.

### Added

- Monitor extension with event-driven classification (message_end, turn_end, agent_end, command)
- JSON-based monitor definitions (.monitor.json), pattern libraries (.patterns.json), instructions (.instructions.json)
- Side-channel LLM classification with CLEAN/FLAG/NEW verdict protocol
- Auto-learning of new patterns from runtime detection
- Write action for structured JSON findings output
- Scope targeting (main, subagent, all, workflow)
- Bundled monitors: fragility, hedge, work-quality
- Slash commands: /monitors, /<name>, /<name> <instruction>
- Status bar integration showing engaged/dismissed monitors
- Escalation with ceiling + ask/dismiss
- SKILL.md for LLM-assisted monitor creation
- JSON schemas for monitor definitions and patterns
