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
  plugins/       surround, targets — engine commands via define*/mapCommand, reached through
                 the bridge's Plugin key hook (ADR 0006), never a fork
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

A plain `Enter` the engine reports unhandled in Normal or Visual (a failed motion such as
`d<CR>` on the last line) is swallowed on every Field, so a half-typed command never submits
a form or inserts a newline. Cmd/Ctrl+Enter stay row-3 Pass-through.

**Lifecycle.** Engine + mirror are created lazily on Activation (first `Esc`/`Ctrl+[`
while focused; on focus itself only under Start Mode Normal), never on focus under Start
Mode Insert. They live while the element stays in the DOM; refocusing
resumes the last Mode. Element removed → destroyed (marks and undo gone), promptly, via a
`MutationObserver` on the document that runs only while a Session exists (it also watches
the shadow root of a Field that lives in one, since records from inside a shadow tree never
reach the document). A framework
re-mount (React key change, conditional render) is a new element and therefore a new Field:
fresh Session, Start Mode per Site Policy, even when the id is the same. An element that
stops qualifying (type changed to password, `readonly`, `disabled`) is destroyed the same
way; a password input revealed as `type="text"` is an ordinary Single-line Field.

**Status Line.** Shadow-rooted strip at the edge of an activated Field: Mode,
pending keys, `recording @q`, the command line for `:` `/` `?`, engine messages
(e.g. `E486`). Never shown on a Field that was not activated; dim `-- INSERT --` after
activation. No page-level bar. It sits below the Field when the strip fits in the
viewport there and above it otherwise, so a Field flush with the bottom of a short
iframe keeps a visible strip; when it fits neither side (a Field taller than the
viewport) it stays below. A Field in an iframe gets its Status Line in that frame's
own document, never in the top page (no cross-frame rendering).

**Frames.** The content script runs in every frame; each frame owns its Fields, Sessions
and Status Lines, and a Field is Activated only by keys and focus inside its own frame.
A frame belongs to the Site of the page around it (GLOSSARY.md **Site**): it resolves the
top origin from `location.ancestorOrigins` (last entry; also works for nested and
sandboxed frames) and falls back to its own origin on a browser without that property (Firefox).

**Cursor.** Normal mode block cursor = native selection of the char under the cursor;
Visual = native selection. No overlay. Visual block edits apply correctly but only the
primary range is highlighted.

**Registers & clipboard.** `"+` is the system clipboard (`clipboardRead`/`clipboardWrite`;
the engine writes on yank and reads at paste time). `"*` is an alias of `"+`: the engine
knows no `*` register, so the bridge rewrites the register name before the engine sees the
key, where its other key decisions live. Before a `"+p`/`"*p` the bridge reads the clipboard
itself: a denied read drops the pending register and shows a Status Line message; the
engine's own read then only ever succeeds. The unnamed register never touches the clipboard.
Cmd+V in Normal is a Pass-through.

**Ex extras.** `:w` → notification no-op, never submits. `:q`/`:q!` → blur the Field.
`:wq`/`:x` → `:w` then `:q`; the Status Line stays until the `:w` notice closes. VimText never discards Field text.

**Session State** (`chrome.storage.session`, shared by all tabs/frames): registers (the
macros and search queries they carry included), search + command history, the last `f`/`t`
search. Per Field: marks, undo, the jump list. vimrc mappings are not stored here: every
Activation re-runs the vimrc from Settings. One key holds a plain-data snapshot of the
engine's global state (`src/engine/globalState.ts`). After every key pressed while a Session
exists, and when the command line closes (it commits its history inside its own input's
listener, after the key has passed the document), the frame snapshots that state and writes it when the
serialized form differs from the last one written or restored; a tab's own write coming back
as a storage change is skipped, every other change is restored into the engine before the next
key. Last writer wins: two tabs editing registers at the same moment end with whichever wrote
last, never a merge. A write the storage rejects (quota, or a read or write before the service
worker's grant) is logged and ignored; the tab keeps its in-memory state. The service worker
(`src/background.ts`) has one job, on install and on browser startup: grant content scripts
access to session storage (`setAccessLevel`). Nothing else runs there.

**Settings** (`chrome.storage.sync`):

- Site Policy keyed by the Site's origin (the top page's, ADR 0005): disabled /
  enabled+Insert / enabled+Normal. Unknown origin → enabled+Insert. No built-in deny list.
  One policy governs every Field on the page, in embedded frames too.
- Settings arrive asynchronously (storage read at load, then every change). The content
  entry treats the Site Policy as unknown until then: nothing is activated, and an
  Activation key reaches the page as usual but is remembered for the Field it was pressed
  on (forgotten when that Field loses focus). Every arrival, first load and later changes
  alike, runs one reconcile step on the focused Field when the document has focus: policy
  "off" disposes every Session; "normal" Activates it; "insert" Activates it only if the
  remembered key was pressed on it. This also catches an `autofocus` Field, which is
  focused before the content script runs, and a popup switch to "normal" while a Field is
  focused. A key pressed before the content script runs at all is lost.
- vimrc: a text box of ex commands (`map`, `noremap`, `set`, …) run through the engine on every
  Activation. The saved vimrc is the whole truth about user mappings: an Activation first clears
  every user mapping (engine mappings are global per frame), then binds each enabled Plugin's
  keys, then runs the vimrc, so a mapping deleted from the vimrc is gone at the next Activation
  in every tab, a vimrc save never disables a Plugin, and a vimrc mapping on a key a Plugin
  also binds wins (as a user's vimrc beats a plugin's default maps in Vim). On save (and on open) the
  options page runs the text through a scratch mirror line by line and lists each failing line
  with the engine's message under the text box; a clean vimrc lists nothing. The content script
  reports nothing for a bad line.
- Plugin toggles (surround, targets), off by default. A toggle takes effect at the next
  Activation in every tab, the rule the vimrc follows.
- Popup: global on/off, Site Policy for the current Site, Mode of the focused Field. Two
  queries to the content script: the Site origin from the top frame only (which also
  proves VimText runs there); the Mode from every frame, where only a frame holding a
  Session on its own active element answers, so a Field focused inside an iframe is
  reported. No answer → "No Field activated".

**Plugins** (`src/plugins/`, one module per Plugin; its oracle is the upstream plugin's own
documentation, GLOSSARY.md **Plugin**). A Plugin defines its operators, motions and actions
once at module load through the engine's `define*` API, and binds its keys through
`mapCommand` on every Activation, because those bindings land in the same keymap partition
as the vimrc's and the Activation's `mapclear` wipes them.

The engine's matcher takes a full match over a partial one and never waits (the `timeoutlen`
deviation under accepted limitations): `d`, `c`, `y` are complete operators and `in` is a
complete text object, so a `ds<character>` binding can never fire and `cin(` resolves as `c`
plus the object `n`. The bridge therefore has one Plugin key hook, where the `"*` rewrite
lives, that turns a typed sequence into a **Plugin Key**, a key name no keyboard produces.
With surround on it holds a `y`, `c` or `d` typed in plain Normal and feeds `<SurroundYs>`
(`<SurroundYss>` after a second `s`), `<SurroundCs>` or `<SurroundDs>` when `s` follows;
Visual `S` is rewritten to `<SurroundS>` at once. With targets on it holds `i`/`a` in
operator-pending and Visual and feeds the next/last Plugin Key when `n`/`l` follows. Esc
discards the held keys, is fed to the engine and counts as pending input, so it never reaches
the page as a bare Esc; any other key releases the held keys into the engine in order and
then takes the normal path. Held keys do not show on the Status Line. The hook knows only
grammar; every semantic (the motion and count after `<SurroundYs>`, text objects, `.`,
macros) is the engine's, running the Plugin's commands. A Plugin key is Key Policy row 1.

The second literal of `ys{motion}{char}` and `cs{old}{new}` is a one-shot catch-all
`<character>` binding the Plugin arms from inside the engine: it survives Pass-through keys
like a pending operator and is cancelled by Esc or any non-printable key the engine
receives. The Field losing focus cancels it too and discards the hook's held keys, so a
wait armed in one Field never takes a key typed in another. `.` repeats `ys`, `cs` and `ds` with the same characters (the Plugin keeps the last
ones and tells a `.` replay from a macro replay by the engine's input state being the
recorded one). Macros record Plugin Keys and replay through the engine unaided.

_surround, v1_: `ys{motion}{char}`, `yss{char}`, `cs{old}{new}`, `ds{old}`, Visual `S{char}`
(charwise and linewise); the four bracket pairs (the opening character adds inner spaces,
the closing one does not) with the aliases `b` `r` `B` `a`, and the three quotes; any other
character wraps literally. _targets, v1_: Seek for the pair and quote objects (`ci(` from
outside the parentheses finds the next pair; `i"` works from anywhere on the line), the
`n`/`l` prefixes (`cin(`, `dil"`, `vin(`), and the argument objects `ia`/`aa`. While a
Plugin is on, the Baseline keys it claims (`i(`, `i"`, Visual `S`) behave as the plugin
makes them behave in Vim.

**Manifest.** MV3. Permissions: `storage`, `clipboardRead`, `clipboardWrite`. Content script
on `http://*/*`, `https://*/*`, `all_frames: true`, `run_at: document_idle`, one classic IIFE
bundle (strict page CSPs block dynamic `import()`). No `activeTab`/`scripting`/`tabs`, no remote code.

## Tooling

TypeScript · esbuild (content, popup, options bundles) · Vitest browser mode (Chromium via
Playwright) for the sync layer · Playwright e2e loading the unpacked extension against local
fixtures (textarea, single-line input, a React 19 controlled input bundled by esbuild into a
gitignored fixture file, a hand-written rewriting Controlled Field standing in for masks and
other frameworks, a page with same-origin, cross-origin and short frames) · GitHub Actions on
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
  filter), the first `u` restores the pre-edit text in the page's form; the page's rewrite of
  that restored text is a new change, so redo is gone and every further `u` appears to do
  nothing (it undoes the rewrite, which the page applies again).
- Fields that reformat in a `setTimeout` or set `.value` with no event are only reconciled on
  the next keystroke; the block cursor is gone until then.
- No VimText in `about:blank` / `srcdoc` / `blob:` frames the page creates: the manifest
  does not opt into `match_origin_as_fallback`. Text inputs there are rare (the common
  case is contenteditable, M4).
- On browsers without `location.ancestorOrigins` (Firefox) a cross-origin frame falls back
  to its own origin as the Site, so the top page's policy does not reach it.
- The popup's Mode comes from any frame holding a Session on its active element, so a
  Field left focused in a background frame can be the one reported.
- Plugins (M3 part 2): a held key (`d` while the hook waits for `s`) is invisible on the Status
  Line for that keystroke. Macros record Plugin Keys, so `:reg` and `"qp` show `<SurroundDs>(`
  where `ds(` was typed; they replay correctly. A vimrc `nnoremap` cannot expand into a Plugin
  key (the engine resolves `noremap` against its own defaults only); `nmap` can. With targets
  on, `cin` followed by a key that is not an object cancels the `c` and stays in Normal mode
  where Vim beeps, as the stock engine does for `cix` (a failed text object ends the operator;
  the hook has no special case). targets' Seek ranks candidates by the default
  `g:targets_seekRanges` with every line taken as on screen (the hidden mirror has no
  viewport), so a next object below always beats a last object above; the implicit Seek for
  a quote stays on the cursor's line (`in"`/`il"` cross lines), and a count on `i"` is the
  count of `n`/`l` only. `ib` is the parentheses pair (Vim's alias), not targets' any-block.
  A pair whose brackets end and start lines of their own is charwise (`ci{` leaves `{}`),
  where Vim's inner block is linewise; `aa` on a sole argument takes its trailing whitespace
  (`( x )` leaves `( )`).
  In Visual, an object typed again grows only when the selection is wider than one
  character (a one-character inner cannot be told from a fresh `v`). Linewise
  Visual `S)` on a Single-line Field yields `(text)` (the newline strip). Visual `S` is not
  `.`-repeatable (vim-surround does not promise it). While `ys{motion}` or `cs{old}` waits for its character, a
  digit `1`-`9` is a count for the key after it, not the character (`ysiw3)` wraps with `)`;
  `0` and every other printable key are taken as typed). After a cancelled wait (Esc), `.`
  repeats that `ys`/`cs` with the last character it completed with, where Vim repeats the
  edit before it. A letter or a space as the replacement wraps with nothing, and `<` or `t`
  (a tag prompt in Vim) does nothing; a linewise wrap is not re-indented (vim-surround's
  `g:surround_indent`). Not in v1: the tag and function targets (`ysiw<div>`, `cst`, `dst`;
  own follow-up issue), `yS` `ySS` `cS` `gS`, Insert-mode `Ctrl-s`; targets' separator
  objects, `I`/`A`, any-block `ib` and any-quote `iq`, tag seeking and `g:targets_*`
  configuration.
- In a cross-origin frame whose embedding page's permissions policy denies clipboard access,
  `"+p`/`"*p` show a Status Line message and leave the text untouched; `"+y` still fills the
  register but the clipboard does not change. On a plain `http://` page (not a secure context)
  there is no clipboard API at all: every `"+`/`"*` command beeps with a Status Line message.

## Milestones

- **M1** textarea + full engine via mirror + Status Line/command line + Site Policy + popup toggle.
- **M2** Single-line Field semantics + Controlled Fields + iframes. Part 1 (Single-line and
  Controlled Fields, issues #7 #8 #9) lands on `main` first; 0.2.0 is tagged only once iframes
  and the settings race (#6) are in.
- **M3** in three parts, each landing on `main`: part 1 clipboard registers (`"*` is an alias
  of `"+`) and Session State across tabs (a minimal service worker grants content scripts
  session storage; last writer wins) plus vimrc error reporting in the options page and
  mappings that replace rather than accumulate; part 2 Plugins (surround with the Plugin key hook first, then targets; decided in the grill
  of 2026-11-08, ADR 0006); part 3 Web Store release (package script, privacy policy in the repo,
  listing, dogfooding on GitHub, Reddit, Hacker News, Stack Overflow). 0.3.0 is tagged at
  the store submission.
- **M4** contenteditable Field (own planning session first).

Each milestone is a usable release.
