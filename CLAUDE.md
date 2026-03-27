# CLAUDE.md

## Project

Pi extension that adds behavior monitors — autonomous watchdogs that classify agent activity against JSON pattern libraries and steer corrections or write structured findings.

## Structure

- `index.ts` — extension entry point (single file)
- `examples/` — bundled monitor JSON files (seeded into `.pi/monitors/` on first run)
- `schemas/` — JSON schemas for monitor definitions and patterns
- `skills/` — SKILL.md for LLM-assisted monitor creation
- `CHANGELOG.md` — maintained via changelogen

## Agent conduct

- Execute proactively. Run every automatable command yourself. Only defer to the user for genuinely interactive operations (npm login, browser auth flows).
- Never leave the working tree dirty. After every change, commit and verify `git status` is porcelain clean.
- After every code change: run `npm run check`, commit, and if releasing: run `npm run release`, `npm run release:push`. Stop only at `npm publish` (interactive auth).
- Update memory when behaviors are corrected or confirmed. Do not wait to be reminded.
- Do not speculate without evidence. Investigate the actual runtime, not stale local types.

## Validation

```bash
npm run check           # full validation: type-check + lint + tests
npm run type-check      # tsc --noEmit only
npm run lint            # biome lint only
npm run lint:fix        # biome auto-fix
npm test                # vitest only
```

Always run `npm run check` before committing. The pre-commit hook enforces this.

`tsc --noEmit` type-checks `index.ts` against the real `.d.ts` files from installed pi packages. This catches SDK API drift that vitest stubs cannot detect. If type-check fails after a pi update, the code needs to be updated to match the new API.

## Keeping dependencies current

Peer deps are set to `"*"` and resolve to whatever version npm installs. To update to latest:

```bash
npm run sync-deps       # updates pi packages to latest
```

CI always installs with fresh resolution (no lockfile) to catch breaking changes.

## Commits

Use conventional commits. Prefix determines version bump:

- `feat:` → minor (0.1.0 → 0.2.0)
- `fix:` → patch (0.1.0 → 0.1.1)
- `feat!:` or `BREAKING CHANGE:` → major (0.1.0 → 1.0.0)
- `docs:`, `chore:`, `refactor:`, `test:`, `perf:` → patch (no behavior change)

## Releasing

```bash
npm run release          # auto-detect bump from commits
npm run release:patch    # force patch
npm run release:minor    # force minor
npm run release:major    # force major
npm run release:push     # git push --follow-tags
```

All release commands are non-interactive and must be run by the agent, not deferred to the user.

## Publishing to npm

Only `npm login` and `npm publish` require interactive CLI auth.

```bash
npm login                # authenticate (interactive, one-time per machine)
npm publish              # publish current version
npm pack --dry-run       # preview what would be published (check files whitelist)
```

The `files` field in package.json controls what's included: `index.ts`, `examples/`, `schemas/`, `skills/`, `README.md`, `CHANGELOG.md`. Everything else (`docs/`, `test/`, `.claude/`, etc.) is excluded.

## Dependencies

No runtime dependencies. Peer dependencies on pi's bundled packages (`@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`, `@sinclair/typebox`).
