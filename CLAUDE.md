# VimText

- Design and milestones: `DESIGN.md`. Vocabulary: `GLOSSARY.md` (use its terms). Decisions: `docs/adr/`.
- Before touching `src/bridge`, `src/engine`, `src/field`, `src/plugins` or `src/ui`, read in `docs/engine-seams.md` its header (where the engine's source is) and the entries the ticket names and any other whose name fits the change (`grep -o '^- \*\*[^*]*' docs/engine-seams.md` lists them): it caches the engine, editor and browser gotchas the bridge, the Fields' write path, the Plugins and the Status Line host depend on.
- Reviewing a diff: `CODING_STANDARDS.md`. Fixes for a review's findings that change `src/` are reviewed again before the PR opens: #98's replaced the fix's mechanism, and only a second review found the edit it lost.
- One gate: `npm run check` (typecheck, import check, unused-code check, unit tests in Chromium, build, e2e against the built extension). Work touching an editor e2e spec or a path `.husky/pre-push` lists also passes `npm run test:e2e:editors` (pre-push's repeated run) before it's called done: in #75 a timing-sensitive test and a multi-write caret bug failed only there. After any e2e run, `npm run e2e:last` prints its failed and flaky tests, each attempt's error and the machine's state: read a run's result there, since a cut terminal output loses it (#77).
- A fresh clone or worktree gets `npm ci` first: it installs the git hooks (pre-commit runs the fast checks, pre-push runs the gate and the editors' run, each unless it already passed on the committed tree). Without it git skips them silently.

## Agent skills

### Issue tracker

GitHub Issues on `Kyu-seok/VimText` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
