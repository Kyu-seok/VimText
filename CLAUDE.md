# VimText

- Design and milestones: `DESIGN.md`. Vocabulary: `GLOSSARY.md` (use its terms). Decisions: `docs/adr/`.
- Before touching `src/bridge` or `src/engine`, read `docs/engine-seams.md`: it caches the engine gotchas the bridge depends on.
- Reviewing a diff: `CODING_STANDARDS.md`.
- One gate: `npm run check` (typecheck, import check, unused-code check, unit tests in Chromium, build, e2e against the built extension).

## Agent skills

### Issue tracker

GitHub Issues on `Kyu-seok/VimText` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
