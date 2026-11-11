---
status: accepted
---

# contenteditable writes: a synthetic `beforeinput` first, `execCommand` as the fallback, judged once the write has settled

Decided in the M4 part 2 grill of 2026-11-12; amends ADR 0007. Each step of a contenteditable write (non-Insert Modes) dispatches a cancelable synthetic `InputEvent('beforeinput')` on the editing host, `inputType` `insertText` (with `data`), `deleteContentBackward` or `insertParagraph`, `targetRanges` the selected DOM range; only when no listener cancelled it does the bridge run the `execCommand` of ADR 0007. The write is asynchronous: its steps are spaced so the page's editor catches up, a render that comes due during it is merged into one write after it, and the Refused Edit and Controlled Field checks read the Field once it has settled. Textarea and input Fields keep their synchronous write.

Why: ADR 0007 predicted that editors taking edits only from `beforeinput` would reconcile, refuse or diverge under `execCommand`, and left it to M4 part 2's fixtures. The research and two spikes answered it (docs/research/editor-write-paths.md; harnesses on the `prototype/editor-write-paths` branch). Under `execCommand` alone, Lexical 0.53 reverts structural changes but keeps the text changes of the same write, so `r<CR>` mid-line loses the text before the caret and `o`, `dd` and a Visual delete across lines go wrong or are refused; Slate (slate-react 0.147, desktop) never reads the DOM back, so every write is a Diverged Edit its next render silently puts back. With the synthetic `beforeinput`, every case came out right in Lexical, Slate and Quill 2.0.3, from a real content script's isolated world, with no write applied twice, and ProseMirror and a bare contenteditable behaved byte-for-byte as before (neither cancels it). Synthetic `beforeinput` is what writing assistants already send these editors: slate-react's source names Grammarly, and Slate's maintainers reverted an `isTrusted` check that broke them (slate#6197).

## Considered options

- **`execCommand` only (ADR 0007 as written)**: corrupts text in Lexical and diverges in Slate, which blocks 0.4.0 under M4 part 2's release rule.
- **A synchronous write with the `beforeinput` first**: an editor that cancels a step applies it to its DOM later (Lexical a microtask later, Slate after React renders), so a native step right after it edits stale DOM (Slate `J`: duplicated text and a React `removeChild` error; Lexical `A\nB`: `B` lost), and the synchronous re-read would take every cancelled write for a Refused Edit.
- **`deleteContent` for deletions**: Lexical and Slate cancel it and do nothing, silently dropping the delete.
- **Reading editor models from an injected page-world script, or detecting a Diverged Edit**: the per-editor adapter ADR 0007 rejected; the projection stays VimText's only signal.

## Consequences

- VimText guarantees a write reaches the editor's model only on editors a pinned fixture covers (Lexical, Slate, Quill, ProseMirror, each exposing its model text to the e2e); elsewhere the projection is the signal, and an editor that both applies the synthetic event and lets it through would write twice. The dogfooding pass is the net.
- The pause between steps and the minimum gap between writes are set by the Slate fixture, not chosen here: Slate ignores `selectionchange` for a while after it renders (about 20 ms in the spike), which a write's reselect needs.
- A write in progress when its Session ends finishes its current step if the host is still connected; queued writes are dropped and nothing is judged.
- Restoring an Atom (`insertHTML`) stays `execCommand` only: no editor handled a `beforeinput` for it. Corrected by #62 (2026-11-12): Lexical cancels a `beforeinput` of `insertFromPaste` and does nothing, and the `insertHTML` restore turned a decorator's whole line into the decorator's text. The restore is now offered as that `beforeinput` first (the Atom's markup as `text/html`), and an editor that cancels it gets no `insertHTML`: on Lexical, `u` restores the text without the decorator (DESIGN.md accepted limitations).
- Insert mode stays native (CODING_STANDARDS rule 4) but for one exception this asynchrony brings (#52): while a VimText write is still settling, Insert typing goes into the mirror (`Session.typeWhileWriting`) and lands with the merged write, since the caret is not yet where the text goes.- Writes land in the editor's own undo history in all four editors; Lexical and Slate may take one undo per step, Quill merges changes within one second into one step. VimText's own `u` is unaffected.
