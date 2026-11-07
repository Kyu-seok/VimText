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

| Surface                                                 | Status                                                         |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| `<textarea>`                                            | first-class, M1                                                |
| `<input>` text/search/url/email/tel (Single-line Field) | first-class, M2                                                |
| contenteditable (Gmail, Slack, Notion, …)               | separate Field implementation, M4, designed in its own session |
| password/number/date/color/file inputs                  | never                                                          |
| canvas editors (Google Docs)                            | impossible, out of scope                                       |

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
- _Controlled Fields_: right after every write, the bridge re-reads the Field. If the page
  rewrote the value synchronously (React controlled component, mask, uppercase filter), the
  rewrite is synced into the mirror joined to the undo step of the change that provoked it,
  cursor at the page's caret clipped to the line. A render whose Field no longer holds the
  text the bridge last wrote does not write at all: it resyncs from the Field and the engine's
  pending change is dropped. Rewrites that arrive later (a page that reformats in a
  `setTimeout`) fire `input` on their own and sync as separate undo steps. Programmatic value
  changes that fire no event are picked up by the self-heal on the next key; no polling.
- _Synthetic input events_: a write dispatches the `input` event Chrome would for the same
  edit, from a diff of old and new text: `insertText` with `data` for an insertion or
  replacement, `deleteContentBackward` for a deletion. No `beforeinput` (M2 decision; a page
  that cancelled it would simply win under self-heal).

**Undo.** `u` / `Ctrl-r` use the engine's history, grouped per Vim change. Native undo is
left alone in Insert mode; in other Modes the browser's undo/redo shortcuts (`Cmd/Ctrl+Z`,
`Cmd+Shift+Z`, `Ctrl+Y`) are swallowed so the page's history never diverges from the
engine's. One history.

**Single-line Fields.** The mirror of a Single-line Field never holds a newline. After any
engine dispatch that leaves one (linewise `p`, `:put`, `Ctrl-r` with a multi-line register,
`:s/x/\r/`) the bridge strips it, exactly as the input's own value sanitization would, in a
change joined to the same undo step. `j k gg G Ctrl-d Ctrl-u` are already no-ops on a
one-line document by engine semantics; only `o`/`O` need policy (rule 7).

**Key Policy in non-Insert Modes** (capture phase on the Field). These rows are decided
before the engine sees the key, so a vimrc mapping (`nnoremap <CR> …`, `nnoremap o …`) never
reaches them:

1. Keys the engine knows: consumed.
2. Printable keys the engine doesn't know: swallowed (Vim beeps).
3. Cmd/Ctrl combos the engine doesn't bind: Pass-through (Cmd+C/V/X, Cmd/Ctrl+Enter, Cmd+W, Cmd+L…), except the undo/redo shortcuts above.
4. `Tab`/`Shift+Tab`: Pass-through (focus navigation).
5. `Esc`/`Ctrl+[` while already in Normal: Pass-through (lets site modals close on 2nd press).
6. `Enter` on a Single-line Field in plain Normal (no pending count or operator): Pass-through
   (submits). In a textarea it is the Vim motion.
7. `o`/`O` on a Single-line Field in Normal: swallowed as a Vim beep, pending count cleared.
   Visual-mode `o`/`O` (other end of the selection) keep working.

**Lifecycle.** Engine + mirror are created lazily on Activation (first `Esc`/`Ctrl+[`
while focused), never on focus. They live while the element stays in the DOM; refocusing
resumes the last Mode. Element removed → destroyed (marks and undo gone), promptly, via a
`MutationObserver` on the document that runs only while a Session exists (it also watches
the shadow root of a Field that lives in one, since records from inside a shadow tree never
reach the document). A framework
re-mount (React key change, conditional render) is a new element and therefore a new Field:
fresh Session, Start Mode per Site Policy, even when the id is the same. An element that
stops qualifying (type changed to password, `readonly`, `disabled`) is destroyed the same
way; a password input revealed as `type="text"` is an ordinary Single-line Field.

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
fixtures (textarea, single-line input, a React 19 controlled input bundled by esbuild into a
gitignored fixture file, a hand-written rewriting Controlled Field standing in for masks and
other frameworks, iframe) · GitHub Actions on
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
- Linewise paste on a Single-line Field concatenates (`yyp` on `ab` gives `abab`): the newline
  is stripped as the input itself would.
- A 2nd `Esc` in Normal on a `type="search"` Field clears it (Chrome's own behaviour, rule 5
  passes the key through). `u` restores the text.
- On a Controlled Field that reformats every edit, the cursor may jump to where the page put
  the caret. A page that rewrites asynchronously leaves its rewrite as a separate undo step,
  so `u` can appear to do nothing there. On a page that filters every write (an uppercase
  filter), `u` restores the pre-edit text in the page's form, and the page's rewrite of that
  restored text is a new change, so the redo of the undone edit is gone.
- Fields that reformat in a `setTimeout` or set `.value` with no event are only reconciled on
  the next keystroke; the block cursor is gone until then.

## Milestones

- **M1** textarea + full engine via mirror + Status Line/command line + Site Policy + popup toggle.
- **M2** Single-line Field semantics + Controlled Fields + iframes. Part 1 (Single-line and
  Controlled Fields, issues #7 #8 #9) lands on `main` first; 0.2.0 is tagged only once iframes
  and the settings race (#6) are in.
- **M3** vimrc, clipboard registers, Session State across tabs, Plugins, Web Store release.
- **M4** contenteditable Field (own planning session first).

Each milestone is a usable release.
