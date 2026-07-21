# VimText

A Chrome (MV3) extension that brings **Vim modal editing** — Normal / Insert /
Visual modes, motions, and operators — to plain `<textarea>` and text `<input>`
fields on the web. Plain-JavaScript ES modules, concatenated into one classic
content script by a tiny dependency-free bundler (no npm dependencies).

## Status: MVP

Implemented core modal editing (see [DESIGN.md](DESIGN.md) for the full design
and [explicitly deferred](DESIGN.md#explicitly-deferred-phase-2-not-in-this-designs-build-scope) features).

### Modes & switching
- Normal, Insert, Visual (charwise), Visual Line
- `Esc` **and** `Ctrl+[` → Normal (identical; `Ctrl+[` is the conflict-free one)
- `i a I A o O` → Insert · `v` → Visual · `V` → Visual Line

### Motions
`h j k l` · `w b e` · `0 ^ $` · `gg` · `G` · `{count}G` (counts prefix anything)

### Operators & editing
`x` · `dd d{motion}` · `cc c{motion}` (`cw`→`ce`) · `yy y{motion}` · `p P` ·
`u` / `Ctrl+r` (custom undo stack, edit-coalesced)

### Search
`/pattern` + `Enter` (smartcase, wrap-around) · `n` / `N`

### Text objects
`iw aw` · brackets `i( a( i[ a[ i{ a{ i< a<` (+ `b` `B` `r` aliases) · quotes `i" a" i' a'`
`` i` a` `` · tags `it at` — compose with any operator (`di(`, `ci"`, `yaw`, `dit`) and in Visual mode.

### Plugins (toggle in Options)
- **vim-surround** — `ys{motion}{c}` add, `cs{a}{b}` change, `ds{c}` delete, visual `S{c}`.
  Brackets & quotes; an opening bracket adds inner spaces, a closing one doesn't (`ysiw(` →
  `( foo )`, `ysiw)` → `(foo)`). Delete/change from an existing tag (`dst`, `cst"`).
- **targets.vim** — seeking (`ci(` works from *outside* the pair) plus next/last objects
  (`cin(`, `cil"`, `dan)`).

## Install (load unpacked)

1. `chrome://extensions`
2. Toggle **Developer mode** (top-right)
3. **Load unpacked** → select this folder
4. Open `tests/fixtures/manual.html` (or any site) and try it

Toolbar popup = global on/off + "disable on this site". Options page = the
per-site disabled list. VimText starts every field in **Insert** (pass-through);
you opt into Normal with `Esc` / `Ctrl+[`, so it never hijacks a page until you
ask it to.

## Architecture

Engine is pure and DOM-free (so it's unit-tested in Node); the DOM layer is a
thin adapter. See `DESIGN.md` for the rationale.

```
content-scripts/
  index.js           entry: keydown(capture) → keymap → engine → DOM renderers
  engine/            state · motions · operators · textobjects · surround · keymap  (pure, testable)
  dom/               write (framework-safe) · cursor · mode-indicator · search-ui · element-tracker
  vimtext.js         GENERATED bundle of all the above — the file the manifest loads
tools/bundle.mjs     concatenates the ES modules into vimtext.js (dependency-free)
options/  popup/     settings UI
tests/engine/        node:test suites
tests/fixtures/      manual.html
```

Two notes worth knowing:
- **Framework-safe writes** (`dom/write.js`): values are set via the native
  prototype setter + a dispatched `input` event, so React/Vue-controlled inputs
  (e.g. GitHub) don't revert our edits.
- **Native-selection cursor** (`dom/cursor.js`): the block cursor is the
  browser's own selection of the char under the cursor — no overlay/mirror-div.
- **Single classic bundle** (`content-scripts/vimtext.js`): the manifest loads
  one generated classic script instead of dynamically importing ES modules. A
  runtime `import()` from a content script is blocked by strict page CSPs
  (Chrome 130+), which would break loading on many sites.

## Testing

Unit tests (no browser needed):

```
npm test        # == node --test
```

### Manual checklist (load-unpacked)
Test on `tests/fixtures/manual.html`, a single-line `<input>`, and a React site
(a GitHub comment box):

- [ ] `Esc` and `Ctrl+[` both return to Normal from **Insert** and from **Visual**
- [ ] `h j k l w b e 0 ^ $ gg G` move as expected; block cursor tracks the char
- [ ] `x dd dw de cc cw yy p P` edit correctly; `u` / `Ctrl+r` undo/redo
- [ ] Counts: `3j`, `3dw`, `2dd`
- [ ] `/pattern` + `Enter`, then `n` / `N`
- [ ] On a React field, edits **stick** (the input-event counter increments)
- [ ] `j k gg G` no-op in a single-line `<input>`
- [ ] Typing and IME/CJK composition are untouched in Insert mode

## Build

The manifest loads one generated bundle. After editing anything under
`content-scripts/`, regenerate it:

```
npm run build   # node tools/bundle.mjs → content-scripts/vimtext.js
```

The bundle is committed so `Load unpacked` works with no install step. CI fails
if the committed bundle drifts from the sources.

## Regenerate icons

```
npm run icons   # node tools/make-icons.mjs
```
