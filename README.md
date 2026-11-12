# VimText

Vim modal editing for the text fields of ordinary web pages. A Chrome extension
that edits the page's own `<textarea>`, `<input>` or rich-text editor in place:
no native host to install, no replacement editor widget.

## Install

Chrome Web Store: https://chromewebstore.google.com/detail/vimtext/egfolppakllammjdjnpbajpioigchbkp

Or load it unpacked from a clone: see [Develop](#develop).

## How it behaves

- **Inert until asked.** A Field starts in Insert mode and behaves natively;
  VimText shows nothing. Press `Esc` or `Ctrl+[` in a focused Field to Activate
  Vim on it; the Field then stays under VimText until it leaves the page. A Site
  Policy (set from the popup or the options page) can give a site the Start Mode
  Normal, so a Field is Activated as soon as it is focused, or turn VimText off
  there. Unknown sites are on and start in Insert.
- **Insert mode is native.** IME, autocomplete and the site's own handlers keep
  working. Only `Esc`, `Ctrl+[`, `Ctrl-o`, `Ctrl-r {register}`, `Ctrl-u` and
  `Ctrl-w` (where the platform lets a page see it) are Vim's.
- **The web stays usable.** In every other Mode a fixed set of keys are
  Pass-through and reach the page untouched: `Cmd`/`Ctrl` shortcuts the engine
  does not bind (`Cmd+C`/`V`/`X`, `Cmd`/`Ctrl+Enter`, `Cmd+L`, ...), `Tab` and
  `Shift+Tab`, a second `Esc` in Normal (so a site's modal still closes), and
  `Enter` on a Single-line Field in plain Normal (so the form still submits).
  The browser's undo/redo shortcuts are swallowed outside Insert so the page's
  history never diverges from `u` / `Ctrl-r`. A printable key Vim does not know
  is swallowed, as Vim beeps.
- `:q` leaves the Field. `:w` is a no-op with a notice (the page owns saving).
  `:wq` and `:x` do both. VimText never discards Field text.
- **Status Line.** A strip at the edge of an Activated Field (below it when
  there is room, above it otherwise) shows the Mode, pending keys,
  `recording @q`, the command line for `:` `/` `?`, and messages such as
  `E486`. It is never shown on a Field that was not Activated; after
  Activation it shows a dim `-- INSERT --`.
- **Clipboard registers.** `"+` is the system clipboard and `"*` is an alias of
  it. The clipboard is read only on a `"+`/`"*` paste and written only when a
  yank, delete or change stores text into `"+`/`"*`; the unnamed register never
  touches it. `Cmd+V` in Normal is a Pass-through.
- **Session State across tabs.** Registers (the macros they hold included),
  search and command history and the last `f`/`t` search are shared by every
  Field in every tab for as long as the browser runs, and gone when it closes.
  Marks, undo history and the jump list belong to one Field.
- **Fields.** `<textarea>`, and the text, search, url, email and tel `<input>`
  types (Single-line Fields), in the top page and in embedded frames, on plain
  pages and on pages whose framework rewrites the value (React controlled
  inputs, masks). contenteditable editors, the rich-text boxes of sites such
  as Gmail, Slack and Notion: one Field per editor, whose text is the editor's
  text without its formatting. VimText's edits go through the editor, so the
  editor's own model takes them; ProseMirror, Lexical, Slate and Quill are
  covered by tests against pinned builds of each. In a multi-line one `Enter`
  in Normal is Vim's motion, so a chat box sends with `Enter` in Insert or
  `Cmd`/`Ctrl+Enter`. When an editor refuses an edit, the editor's text stays
  and the Status Line says so. Password, number, date and file inputs never;
  canvas editors (Google Docs) are out of scope.
- **On contenteditable editors** VimText edits the text and leaves the
  formatting to the editor, which shows in a few places:
  - Yank and put carry plain text, never formatting. `Cmd+V` keeps the
    editor's own rich paste.
  - `u` restores the text, not always its formatting: a character put back at
    the start of a bold run comes back plain, and an undone line join can
    leave a line in another kind of block. Text written at the end of a
    formatted run takes that formatting, as typing there would.
  - A mention chip or an inline image (an Atom) counts as one character. `u`
    brings it back only while VimText still holds it (the last 200 removed in
    that Field). On Lexical, `u` after deleting one restores the text around
    it, without the chip or image.
  - VimText's edits are in the editor's own undo history too, so `Cmd+Z` in
    Insert can undo them; VimText catches up on the next key.
  - Notion makes each block its own editor, so each block is a Field and
    `j`/`k` stop at its edge.
  - Display-line motions and scrolls approximate on mixed fonts and sizes.
  - On an editor without a pinned test, VimText sees only the page's text, so
    an edit the editor's model did not take can go unnoticed.
  - An editor inside a closed shadow root is out of reach.
- **Options page.** A vimrc box of ex commands (`nnoremap Y y$`,
  `set ignorecase`, ...) run on every Activation, with each failing line listed
  under the box; the Plugin toggles; the Site Policy table. The popup holds the
  global on/off switch, the Site Policy for the current site and the Mode of
  the focused Field.

## Baseline

The Baseline is what Vim does, as documented in `:help`; that is the oracle for
"correct". VimText reuses the Vim engine behind CodeMirror
(`@replit/codemirror-vim`, [ADR 0001](docs/adr/0001-reuse-codemirror-vim-engine.md)),
so motions, operators, text objects, counts, registers, marks, macros, Visual
charwise, linewise and block, `.`, search and ex commands (`:s`, `:g`, `:sort`,
`:map`, `:set`, ...) work on day one. VimText itself is the bridge between that
engine and the page. Where the engine or the bridge deviates from Vim, the
[accepted limitations in DESIGN.md](DESIGN.md#accepted-limitations) say so.

## Plugins

A Plugin is an opt-in behaviour modelled on a well-known Vim plugin, never part
of the Baseline. Both are **off by default** and are switched on in the options
page; a toggle takes effect at the next Activation in every tab. The upstream
plugin's own documentation is the oracle.

- **surround** (vim-surround), v1: `ys{motion}{char}`, `yss{char}`,
  `cs{old}{new}`, `ds{old}` and Visual `S{char}` (charwise and linewise); the
  four bracket pairs (the opening character adds inner spaces, the closing one
  does not) with the aliases `b` `r` `B` `a`, and the three quotes; any other
  character wraps literally. `.` repeats `ys`, `cs` and `ds` with the same
  characters. Not in v1: the tag and function targets (`ysiw<div>`, `cst`,
  `dst`), `yS` `ySS` `cS` `gS`, Insert-mode `Ctrl-s`.
- **targets** (targets.vim), v1: Seek for the pair and quote objects (`ci(`
  from outside the parentheses finds the next pair; `i"` works from anywhere on
  the line), the `n`/`l` prefixes (`cin(`, `dil"`, `vin(`), and the argument
  objects `ia`/`aa`. Not in v1: the separator objects, `I`/`A`, any-block `ib`
  and any-quote `iq`, tag seeking, `g:targets_*` configuration.

While a Plugin is on, the Baseline keys it claims (`i(`, `i"`, Visual `S`)
behave as the plugin makes them behave in Vim, and a vimrc mapping on a key a
Plugin also binds wins. The points where each Plugin differs from its upstream
are listed under the
[accepted limitations in DESIGN.md](DESIGN.md#accepted-limitations).

## Develop

```sh
npm ci                 # also installs the git hooks (pre-commit, pre-push)
npm run build          # → dist/
npm run watch          # rebuild dist/ on change (then reload the extension in Chrome)
npm run typecheck
npm test               # Vitest, two projects: sync-layer unit tests in real Chromium, repo-wide consistency checks in Node
npm run test:e2e       # Playwright drives the built extension against tests/fixtures
npm run screenshots    # regenerates the store PNGs under docs/store/ from a fixture (outside the gate)
npm run package        # builds and zips dist/ for the store, see docs/release.md
npm run check          # the one gate: typecheck, import and unused-code checks, unit, build, e2e
```

Load unpacked: `chrome://extensions` → Developer mode → **Load unpacked** →
select `dist/`.

```
src/
  engine/        hidden CodeMirror 6 view running the Vim engine (the "mirror"); vimrc; Plugin API
  field/         Field abstraction + the textarea/input implementation
  bridge/        Session: key routing by Mode, Field↔mirror sync, cursor; the Plugin key hook
  content/       Sessions of one frame; Session State sync with storage
  ui/            Status Line (shadow DOM)
  settings/      Site Policies, vimrc, Plugin toggles (storage.sync); Session State (storage.session)
  plugins/       surround, targets: engine commands reached through the bridge's key hook
  content.ts     entry: capture-phase keydown → bridge
  background.ts  service worker: grants content scripts session storage, nothing else
popup/ options/  plain HTML + TS
tests/           unit/ (Vitest in Chromium) · node/ (Vitest in Node: repo-wide consistency checks) · e2e/ (Playwright) · screenshots/ (the store PNGs) · fixtures/
```

Design: [DESIGN.md](DESIGN.md) · Vocabulary: [GLOSSARY.md](GLOSSARY.md) ·
Decisions: [docs/adr](docs/adr) · Engine gotchas: [docs/engine-seams.md](docs/engine-seams.md) ·
Cutting a release: [docs/release.md](docs/release.md).

## Privacy

No analytics, no network requests, no remote code. Settings travel with Chrome
Sync when you have it on and otherwise stay on the device; registers and
history live in session storage and are gone when the browser closes; the
content script runs on every page but reads only the Field you Activated. The
full policy is [PRIVACY.md](PRIVACY.md).

## Status

0.4.0 closes M4: contenteditable editors are Fields. Earlier milestones brought
the textarea with the full engine and the command line (M1), Single-line
Fields, Controlled Fields and frames (M2), and clipboard registers, Session
State across tabs, the surround and targets Plugins and the Web Store release
(M3). See the
[milestones](DESIGN.md#milestones) and the
[accepted limitations](DESIGN.md#accepted-limitations) in DESIGN.md.

MIT licensed.
