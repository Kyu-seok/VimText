# VimText

- Design and milestones: `DESIGN.md`. Vocabulary: `GLOSSARY.md` (use its terms). Decisions: `docs/adr/`.
- Before touching `src/bridge` or `src/engine`, read `docs/engine-seams.md`: it caches the engine gotchas the bridge depends on.
- Reviewing a diff: `CODING_STANDARDS.md`.
- One gate: `npm run check` (typecheck, import check, unit tests in Chromium, build, e2e against the built extension).
