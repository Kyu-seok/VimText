# prototype/editor-write-paths

Throwaway spike harnesses behind `docs/research/editor-write-paths.md` and ADR 0008 (M4 part 2).
Kept as a primary source, not maintained. Playwright 1.65 / Chromium 158.0.8127.18.

- `spike-execcommand/`: VimText's execCommand-only write against Lexical 0.53.0, Slate 0.147.x and Quill 2.0.3 (2026-11-11).
- `spike-beforeinput/`: synthetic cancelable `beforeinput` + `execCommand` fallback, the same editors plus ProseMirror (repo pins) and a bare contenteditable, from the page and from a real MV3 content script (`run-ext.mjs`, `ext/`). Results in `RESULTS.md`, raw data in `out*.json` (2026-11-12).

The scripts hold absolute paths from the machine they ran on (`/private/tmp/edexp*`). Not committed: `pm.js` (esbuild bundle of `pm-entry.js` against VimText's node_modules) and `src/slate-react.js` (a copy of slate-react's npm build).
