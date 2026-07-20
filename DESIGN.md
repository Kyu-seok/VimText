# VimText — Chrome Extension for Vim-style Text Editing

## Context

VimText is a Chrome extension that brings Vim modal editing (Normal/Insert/Visual modes, motions, operators, mode-switch via both `Esc` and `Ctrl+[`) to text fields on the web. This document is the design/planning artifact: it confirms feasibility, lays out how the extension would be built, and enumerates which Vim features are realistic to bring over.

Scope decisions:
- **Target**: plain `<textarea>` and `<input type="text">` fields only for v1 (not contenteditable rich editors — those are phase 2/stretch, and canvas-rendered editors like Google Docs are categorically unsupportable).
- **Stack**: plain JavaScript, no build step — load-unpacked-and-iterate workflow.
- **MVP depth**: core modal editing (not a bare proof-of-concept, not the full feature set either).

## Is it feasible?

Yes. This is a well-trodden category — precedent exists in CodeMirror's `vim` mode (in-editor, not page-wide) and various "Vimium-like" extensions (which do page navigation, not text editing). Page-wide modal text editing on arbitrary `<textarea>`/`<input>` elements is harder than an embedded editor because:
- You don't control the site's own keydown handlers — you must intercept in the **capture phase** and prevent default/stop propagation carefully.
- You must simulate a block cursor and mode indicator yourself; nothing native gives you a Vim-style caret in a plain input.
- `Esc` and `Ctrl+[` are not delivered identically across all elements/browsers — both need explicit binding.
- IME composition (CJK input) must be respected — never intercept mid-`compositionstart`/`compositionend`.

None of this is a blocker; it's implementation care. The realistic risk areas (site keybinding conflicts, e.g. GitHub's `/` for search, or modals that close on `Escape`) are handled with a per-site enable/disable list and an "insert mode is the safe default" philosophy (extension does nothing until Normal mode is explicitly entered).

## Architecture

Split cleanly into two layers so the editing logic is unit-testable without a DOM:

```
VimText/
  manifest.json                 # MV3 manifest
  content-scripts/
    engine/
      state.js                  # mode enum, per-element vim state (mode, register, pending count/operator)
      motions.js                # h j k l w b e 0 $ ^ gg G {count}G  — pure functions: (text, cursorPos) -> newPos
      operators.js               # d c y (combine with a motion or text object) — pure functions: (text, range) -> {text, cursorPos}
      keymap.js                 # translates KeyboardEvent sequences into engine commands, handles counts/pending state
    dom/
      element-tracker.js        # tracks currently-focused textarea/input, attaches/detaches per-element state
      caret-overlay.js          # renders a fake block cursor (absolutely-positioned div over a mirror-div technique) for Normal/Visual mode, since native caret is a thin line
      mode-indicator.js         # small fixed-position badge: -- NORMAL --, -- INSERT --, -- VISUAL --
    index.js                    # entry point: global keydown listener (capture:true), wires keymap -> engine -> dom
  options/
    options.html / options.js   # per-site enable/disable list, stored in chrome.storage.sync
  popup/
    popup.html / popup.js       # quick on/off toggle + current mode display
  icons/
  tests/
    engine/*.test.js            # plain Node tests (e.g. node:test) against pure engine functions — no DOM needed
```

**Why split engine from DOM**: motions and operators are pure text-transformation functions (`(text, cursorPos, count) -> newCursorPos` or `(text, range) -> newText`). Keeping them DOM-free means they can be unit tested directly in Node without spinning up a browser, and the same engine could later target `contenteditable` via a different adapter without rewriting the logic.

**Key interception flow**:
1. `index.js` listens for `keydown` on `document` with `{capture: true}`.
2. If `event.target` isn't a tracked `<textarea>`/`<input type=text>`, or the extension is disabled for this site, or an IME composition is active, or current mode is Insert (except for the mode-switch keys), pass through untouched.
3. Otherwise, `keymap.js` consumes the key: builds up pending counts/operators, or dispatches a complete command to `motions.js`/`operators.js`, updates `element.value` + `selectionStart/selectionEnd` directly, and calls `event.preventDefault()` + `stopPropagation()`.
4. `caret-overlay.js` and `mode-indicator.js` re-render after every state change.

**Mode switching**: both `Escape` and `Ctrl+[` map to "return to Normal mode" — handled as two keymap entries pointing at the same handler, checked before any other key processing so they always work regardless of pending state.

**Undo/redo**: Vim's `u` / `Ctrl+r` semantics (undo *changes*, not keystrokes) don't map onto native browser undo. Maintain a custom undo stack: snapshot `{value, cursorPos}` before each change-producing command, coalescing consecutive Insert-mode edits into one entry (flushed on mode-exit to Normal), so `u` undoes "one edit" the way Vim users expect.

## Vim Features for the MVP (core modal editing)

**Modes**
- Normal (default once activated), Insert, Visual, Visual Line

**Mode switches**
- `Esc` → Normal (from anywhere)
- `Ctrl+[` → Normal (explicit ask from user; identical behavior to Esc)
- `i` / `a` / `I` / `A` / `o` / `O` → Insert (before/after cursor, start/end of line, new line below/above)
- `v` → Visual (charwise), `V` → Visual Line

**Motions**
- `h j k l` — left/down/up/right
- `w b e` — word forward/back/end
- `0 ^ $` — start of line / first non-blank / end of line
- `gg` / `G` / `{count}G` — start of field / end of field / go to line

**Operators + editing**
- `x` — delete char under cursor
- `dd`, `d{motion}` — delete line / delete to motion
- `cc`, `c{motion}` — change line / change to motion (deletes then enters Insert)
- `yy`, `y{motion}` — yank line / yank to motion
- `p` / `P` — paste after/before
- `u` / `Ctrl+r` — undo / redo (custom stack, see above)
- Numeric counts prefix any of the above (`3dw`, `5j`, etc.)

**Search**
- `/pattern` + `Enter`, `n` / `N` — next/previous match within the field

This mirrors what a daily Vim user reaches for 90% of the time in a text field, while staying inside the "safe to reason about on a single textarea" boundary (no cross-buffer registers, no macros, no marks yet).

## Explicitly deferred (phase 2+, not in this design's build scope)

- Visual Block mode, text objects (`iw`, `a(`, `i"`, `ip`, etc.), `f`/`F`/`t`/`T`/`;`, `%`, `{`/`}` paragraph motions, marks
- Named registers, macros (`q`, `@`), dot-repeat (`.`)
- Replace mode (`R`), `r{char}`
- Ex command line (`:s/.../.../`, ranges)
- `contenteditable` support (Gmail/Notion/Slack) — best-effort only, separate DOM adapter, real risk of conflicting with the host site's own handlers
- Custom keybinding remapping UI, leader key
- Google Docs and other canvas-rendered editors — not supportable at all (no accessible DOM)

## Known risk areas to design around from day one

- **Per-site conflicts**: sites bind `Escape`/`/`/etc. themselves (GitHub, YouTube, modal dialogs). Mitigation: options page allow/deny list (`chrome.storage.sync`), default to a conservative built-in exclude list for well-known conflict sites, and never intercept anything while in Insert mode except the explicit mode-switch keys.
- **IME composition**: never act on keys while `compositionstart`…`compositionend` is active, or CJK input breaks.
- **Single-line `<input>` semantics**: `j`/`k`/`gg`/`G` don't make sense on a one-line field — keymap.js should no-op or fall back sensibly rather than erroring.
- **MV3 constraints**: no remote code execution, so keep everything bundled in the extension (no eval, no CDN scripts) — trivial to satisfy since there's no build step anyway.

## Verification (once implementation begins)

- Unit tests (Node, no browser) for every motion/operator in `engine/*.test.js` — assert `(text, cursorPos, count) -> expected` for each command.
- Manual load-unpacked testing in Chrome (`chrome://extensions` → Load unpacked) against: a plain `<textarea>` test page, a single-line `<input>`, and 2-3 real sites (e.g., a GitHub comment box) to confirm no conflicts with host-page shortcuts.
- Confirm both `Esc` and `Ctrl+[` return to Normal mode from Insert and from Visual.
