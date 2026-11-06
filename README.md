# VimText

Vim modal editing for the text fields of ordinary web pages. A Chrome (MV3)
extension that edits the page's own `<textarea>` / `<input>` in place, with no
native host to install.

VimText reuses the Vim engine behind CodeMirror (`@replit/codemirror-vim`), so
motions, operators, text objects, registers, marks, macros, visual block, `.`,
and ex commands (`:s`, `:g`, `:sort`, `:map`, `:set`, …) all work on day one.
VimText itself is the bridge between that engine and the page.

- Design: [DESIGN.md](DESIGN.md) · Vocabulary: [GLOSSARY.md](GLOSSARY.md) · Decisions: [docs/adr](docs/adr)

## How it behaves

- **Inert until asked.** Every field starts in Insert mode and behaves natively.
  Press `Esc` or `Ctrl+[` to activate Vim on that field. A Site Policy can make a
  site start in Normal mode instead, or turn VimText off there.
- **Insert mode is native.** IME, autocomplete, and the site's own handlers keep
  working. Only `Esc`, `Ctrl+[`, `Ctrl-o`, `Ctrl-r`, `Ctrl-u`, `Ctrl-w` are Vim's.
- **The web stays usable.** `Cmd/Ctrl` shortcuts the engine doesn't bind, `Tab`,
  a second `Esc` in Normal mode, and `Enter` in single-line inputs all reach the page.
- `:q` leaves the field. `:w` is a no-op (the page owns saving). `:wq` does both.
- A Status Line under the field shows the mode, pending keys, the `:` `/` `?`
  command line, and messages.
- Options page: a **vimrc** box (`nnoremap Y y$`, `set ignorecase`, …), plugin
  toggles, and the Site Policy table.

## Install (load unpacked)

```sh
npm install
npm run build          # → dist/
```

Then `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`.

## Develop

```sh
npm run watch          # rebuild dist/ on change (reload the extension in Chrome)
npm run typecheck
npm test               # sync-layer tests in real Chromium (Vitest browser mode)
npm run test:e2e       # Playwright drives the built extension against tests/fixtures
```

```
src/
  engine/   hidden CodeMirror 6 view running the Vim engine (the "mirror")
  field/    Field abstraction + textarea/input implementation
  bridge/   Session: key routing by mode, Field↔mirror sync, cursor rendering
  ui/       Status Line (shadow DOM)
  settings/ Site Policies, vimrc, plugin toggles (chrome.storage.sync)
  content.ts
popup/ options/   plain HTML + TS
```

## Status

M1 (textarea + full engine + command line + Site Policy + popup). See the
milestones and accepted limitations in [DESIGN.md](DESIGN.md).
