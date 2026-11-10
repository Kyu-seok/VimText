---
status: accepted
---

# contenteditable: a plain-text projection, written back through native editing commands

Decided in the M4 grill of 2026-11-10. A contenteditable Field is, to the bridge and the engine, plain text plus offsets, exactly like a textarea: block boundaries are line breaks, formatting is outside the model, registers stay plain text. A write in a non-Insert Mode never touches the DOM directly: the bridge selects the DOM range of the diff between old and new text and runs `document.execCommand` (`insertText`, `delete`), which fires the real `beforeinput`/`input` events every rich editor (ProseMirror, Lexical, Slate, Quill, Draft) already handles as typing. The editor's own model stays authoritative; whatever it does with the edit (smart quotes, autolinks, refusing it) is a Controlled Field rewrite under ADR 0004.

## Considered options

- **Direct DOM mutation** (`textContent`, `Range.insertNode`): rich editors revert it or their model silently diverges from the DOM, which corrupts text on the next edit.
- **Per-editor adapters** calling ProseMirror/Lexical APIs: unbounded work, and the content script's isolated world cannot reach the page's editor instances.
- **A structure-aware model** (Vim sees marks and nodes): needs a new engine seam and is not Baseline; Vim has no notion of bold.

## Consequences

- `execCommand` is deprecated but has no replacement and Chrome keeps it; if it goes, this ADR is revisited, not worked around per site.
- Formatting is preserved around an edit because the editor applies it; yank and put carry plain text only.
- VimText's edits land in the editor's own undo history as ordinary user edits.
