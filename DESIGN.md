# VimText — Design

Vim modal editing for the text fields of ordinary web pages, in place, with no
native host. Vocabulary is defined in [GLOSSARY.md](GLOSSARY.md); the engine
decision is recorded in [docs/adr/0001](docs/adr/0001-reuse-codemirror-vim-engine.md).

## Positioning

- Install from the Web Store and go. No native messaging host (that niche is Firenvim's).
- Edits the page's own Field in place. No replacement editor widget (that niche is wasavi/Vimput's).
- Chrome first, WebExtension-portable (only `chrome.storage` and standard MV3 APIs).
- **Baseline = Vim** as documented in `:help`. Plugin behaviour (surround, targets) is opt-in and never part of "is it Vim".

## Scope

| Surface                                   | Status                                                         |
| ----------------------------------------- | -------------------------------------------------------------- |
| `<textarea>`                              | first-class, M1                                                |
| `<input>` type text/search/url/email/tel  | first-class, M2                                                |
| contenteditable (Gmail, Slack, Notion, …) | separate Field implementation, M4, designed in its own session |
| password/number/date/color/file inputs    | never                                                          |
| canvas editors (Google Docs)              | impossible, out of scope                                       |

## Architecture

```
src/
  engine/        @replit/codemirror-vim on a hidden CodeMirror 6 view (the "mirror")
  field/         Field abstraction + TextareaField (M1/M2), ContentEditableField (M4)
  bridge/        sync: Field <-> mirror, key routing, ownership rules, self-heal
  ui/            Status Line (shadow root): mode, pending keys, recording, command line, messages
  settings/      Site Policy, vimrc, Plugin toggles (storage.sync); Session State (storage.session)
  plugins/       surround, targets — built on the engine's define*/map API, never a fork
  content.ts     entry: capture-phase keydown → bridge
popup/ options/  plain HTML + TS
tests/           Vitest browser mode (sync layer) · Playwright e2e (unpacked extension, fixtures)
```

**Engine.** `@replit/codemirror-vim` (engine `@replit/codemirror-vim-core`) pinned to an
exact version. Keys are fed with `Vim.handleKey`. The mirror is an offscreen CodeMirror 6
view in VimText's shadow root, styled with the Field's computed font/width/padding/wrapping
so display-line motions (`gj`/`gk`) approximately match. Own-adapter over the Field is the
documented escape hatch (ADR 0001).

**Ownership of text, by Mode.**

- _Insert_: the real Field owns typing (IME, autocomplete, site handlers all native). The
  mirror follows via `input` events. VimText intercepts only the mode-switch keys (`Esc`,
  `Ctrl+[`) and a whitelist of Vim insert keys: `Ctrl-o`, `Ctrl-r {reg}`, `Ctrl-u`, and
  `Ctrl-w` where the platform lets a page see it. While the engine is waiting for the rest
  of a whitelisted key (the register after `Ctrl-r`), the keys that complete it are its too.
- _Every other Mode_ (Normal, Visual ×3, Replace, Command-line): the engine owns the text.
  VimText writes through to the Field with the native value setter + synthetic `input`
  event (framework-safe; React/Vue-controlled inputs keep our edits).
- _Self-heal_: before dispatching any key in a non-Insert Mode, compare Field value +
  selection with the mirror; if they differ, reset the mirror from the Field as one undoable
  change. The Field is the truth whenever they disagree.

**Undo.** `u` / `Ctrl-r` use the engine's history, grouped per Vim change. Native undo is
left alone in Insert mode; in other Modes the browser's undo/redo shortcuts (`Cmd/Ctrl+Z`,
`Cmd+Shift+Z`, `Ctrl+Y`) are swallowed so the page's history never diverges from the
engine's. One history.

**Key policy in non-Insert Modes** (capture phase on the Field):

1. Keys the engine knows: consumed.
2. Printable keys the engine doesn't know: swallowed (Vim beeps).
3. Cmd/Ctrl combos the engine doesn't bind: Pass-through (Cmd+C/V/X, Cmd/Ctrl+Enter, Cmd+W, Cmd+L…), except the undo/redo shortcuts above.
4. `Tab`/`Shift+Tab`: Pass-through (focus navigation).
5. `Esc`/`Ctrl+[` while already in Normal: Pass-through (lets site modals close on 2nd press).
6. `Enter` in a single-line input in Normal: Pass-through (submits). In a textarea it is the Vim motion.
7. `j k gg G o O` on single-line inputs: no-ops.

**Lifecycle.** Engine + mirror are created lazily on Activation (first `Esc`/`Ctrl+[`
while focused), never on focus. They live while the element stays in the DOM; refocusing
resumes the last Mode. Element removed → destroyed (marks and undo gone).

**Status Line.** Shadow-rooted strip at the bottom edge of an activated Field: Mode,
pending keys, `recording @q`, the command line for `:` `/` `?`, engine messages
(e.g. `E486`). Never shown on a Field that was not activated; dim `-- INSERT --` after
activation. No page-level bar.

**Cursor.** Normal mode block cursor = native selection of the char under the cursor;
Visual = native selection. No overlay. Visual block edits apply correctly but only the
primary range is highlighted.

**Registers & clipboard.** `"+`/`"*` are the system clipboard (`clipboardRead`/`clipboardWrite`;
write on yank, read at paste time). The unnamed register never touches the clipboard.
Cmd+V in Normal is a Pass-through.

**Ex extras.** `:w` → notification no-op, never submits. `:q`/`:q!` → blur the Field.
`:wq`/`:x` → `:w` then `:q`; the Status Line stays until the `:w` notice closes. VimText never discards Field text.

**Session State** (`chrome.storage.session`, shared by all tabs/frames): registers, macros,
search + command history, vimrc mappings. Per Field: marks, undo.

**Settings** (`chrome.storage.sync`):

- Site Policy keyed by origin: disabled / enabled+Insert / enabled+Normal. Unknown origin →
  enabled+Insert. No built-in deny list.
- vimrc: a text box of ex commands (`map`, `noremap`, `set`, …) run through the engine on every Activation.
- Plugin toggles (surround, targets), off by default.
- Popup: global on/off, Site Policy for current origin, Mode of the focused Field.

**Manifest.** MV3. Permissions: `storage`, `clipboardRead`, `clipboardWrite`. Content script
on `http://*/*`, `https://*/*`, `all_frames: true`, `run_at: document_idle`, one classic IIFE
bundle (strict page CSPs block dynamic `import()`). No `activeTab`/`scripting`/`tabs`, no remote code.

## Tooling

TypeScript · esbuild (content, popup, options bundles) · Vitest browser mode (Chromium via
Playwright) for the sync layer · Playwright e2e loading the unpacked extension against local
fixtures (textarea, single-line input, React-controlled input, iframe) · GitHub Actions on
push/PR · MIT · version restarts at 0.1.0. Upstream engine tests are not re-run here.

## Accepted limitations (M1–M3)

- No `hlsearch` highlighting in textarea/input (`n`/`N` work).
- Scroll commands (`Ctrl-d/u/f/b`, `zz/zt/zb`) approximate via visible line count and `scrollTop`.
- Replace-mode cursor indistinguishable from Normal except via the Status Line.
- Display-line motions are approximate on exotic fonts/CSS.
- Visual block highlights only the primary range.
- Engine deviation: a user mapping whose prefix is itself a bound key (e.g. `nnoremap <Space>x dd`
  while `<Space>` is `l`) never fires; the engine takes the full match at once instead of waiting
  like Vim's `timeoutlen`. Map from an unbound prefix such as `\` instead. Upstream behaviour, not ours.
- `:%s` ends with the engine's "Found N matches" notice rather than Vim's "N substitutions on M lines".

## Milestones

- **M1** textarea + full engine via mirror + Status Line/command line + Site Policy + popup toggle.
- **M2** single-line input semantics + framework-controlled fields + iframes.
- **M3** vimrc, clipboard registers, Session State across tabs, Plugins, Web Store release.
- **M4** contenteditable Field (own planning session first).

Each milestone is a usable release.
