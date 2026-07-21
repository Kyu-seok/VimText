# Contributing to VimText

Thanks for your interest! VimText is a plain-JavaScript Chrome MV3 extension. The
sources are ES modules; a tiny dependency-free bundler concatenates them into the
single classic content script the manifest loads (`npm run build`).

## Getting set up

1. Clone the repo.
2. Load it in Chrome: `chrome://extensions` → enable **Developer mode** →
   **Load unpacked** → select the repo folder.
3. Open `tests/fixtures/manual.html` (or any site with a `<textarea>`) to try it.

Reload the extension from `chrome://extensions` after changing files.

## Running tests

The editing engine is pure and DOM-free, so it's unit-tested in Node — no browser
needed:

```
npm test        # == node --test
```

Please keep the suite green and add tests for new motions/operators.

## Building

The manifest loads one generated file, `content-scripts/vimtext.js`. After editing
anything under `content-scripts/`, regenerate it:

```
npm run build   # node tools/bundle.mjs
```

The bundle is committed (so `Load unpacked` needs no install), and CI fails if it
drifts from the sources. Because every module shares one scope in the bundle, the
bundler **errors on any duplicate top-level name** — keep function/const names
unique across modules.

## Code layout

VimText is split into two layers on purpose:

- `content-scripts/engine/` — **pure, DOM-free** logic (`state`, `motions`,
  `operators`, `textobjects`, `surround`, `keymap`). Motions/operators/objects
  are `(text, pos, …) -> result` functions. This is where editing behavior lives
  and where tests go (`tests/engine/`).
- `content-scripts/dom/` — a thin adapter that reads/writes the focused field and
  renders the cursor (`write`, `cursor`, `mode-indicator`, `search-ui`,
  `element-tracker`). `content-scripts/index.js` wires keydown → engine → DOM.

Guidelines:

- Keep the engine free of any DOM / `chrome` references so it stays testable in Node.
- All field writes go through `dom/write.js` (native value setter + dispatched
  `input` event) so React/Vue-controlled inputs don't revert edits — never assign
  `el.value` directly.
- Run `npm run build` after editing any `content-scripts/` module so the committed
  `vimtext.js` bundle stays in sync.
- Regenerate icons with `npm run icons` if you change `tools/make-icons.mjs`.

## Scope

See `DESIGN.md` for what's in scope (plain `<textarea>` / text `<input>`) and what's
deferred (contenteditable editors, macros, dot-repeat, ex commands, …). Please open
an issue before starting large phase-2 work so we can align on the approach.
