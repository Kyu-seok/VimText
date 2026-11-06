---
status: accepted
---

# Reuse the CodeMirror Vim engine instead of hand-writing one

VimText's goal is as much of Vim as the web allows. The first attempt (v0.1.0, wiped in commit 424dba0) hand-wrote motions, operators and text objects and plateaued well short of ex commands, registers, marks and macros. We now reuse `@replit/codemirror-vim` (engine: `@replit/codemirror-vim-core`, the Vim mode originally written for CodeMirror, with a 700+ test suite covering ex commands, registers, marks, macros, visual block, text objects) and own only the bridge between it and the page's Field. The engine runs against a hidden CodeMirror 6 view ("mirror") mounted offscreen in VimText's own shadow root; text and selection are synced between the mirror and the real Field.

## Considered options

- **Hand-written engine** (v0.1.0): full control, no dependencies, but every Vim feature is ours to write and test; this is what capped parity.
- **Own adapter over the Field**: implement the engine's CodeMirror-5-style interface (~50 methods, including bookmarks that track edits, search cursors, dialogs, bracket scanning) directly on the Field. No mirror and no CodeMirror payload, but ~1,500 lines of subtle code against an interface extracted into its own package only days before this decision. Kept as the escape hatch if the mirror proves unreliable; the Field abstraction must keep that swap engine-invisible.
- **Real Vim via WebAssembly**: true parity but multi-megabyte payload per tab and an awkward bridge.

## Consequences

- A build step (TypeScript + bundler) is mandatory; the no-dependency purity of v0.1.0 is gone.
- Ownership of text is split by Mode: in Insert the real Field owns typing (so IME, autocomplete and site handlers keep working) and the mirror follows it; in every other Mode the engine owns the text and VimText writes through to the Field.
- Undo is the engine's history only; native undo is not bound outside Insert mode.
- Behavioural bugs in Vim semantics are upstream issues, not ours; bugs in sync are ours.
