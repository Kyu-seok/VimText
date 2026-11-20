# VimText

- Design and milestones: `DESIGN.md`. Vocabulary: `GLOSSARY.md` (use its terms). Decisions: `docs/adr/`.
- Before touching `src/bridge`, `src/engine`, `src/field`, `src/plugins` or `src/ui`, read `docs/engine-seams.md`: it caches the engine, editor and browser gotchas the bridge, the Fields' write path, the Plugins and the Status Line host depend on.
- Reviewing a diff: `CODING_STANDARDS.md`.
- One gate: `npm run check` (typecheck, import check, unused-code check, unit tests in Chromium, build, e2e against the built extension). Work touching an editor e2e spec or a path `.husky/pre-push` lists also passes `npm run test:e2e:editors` (pre-push's repeated run) before it's called done: in #75 a timing-sensitive test and a multi-write caret bug failed only there. After any e2e run, `npm run e2e:last` prints its failed and flaky tests, each attempt's error and the machine's state: read a run's result there, since a cut terminal output loses it (#77).
- A fresh clone or worktree gets `npm ci` first: it installs the git hooks (pre-commit runs the fast checks, pre-push runs the gate). Without it git skips them silently.

## Agent skills

### Issue tracker

GitHub Issues on `Kyu-seok/VimText` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
