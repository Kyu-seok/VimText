---
status: accepted
---

# On a contenteditable Field, VimText draws the Normal-mode Cursor; the page's selection stays a collapsed caret

Decided in the #71 grill of 2026-11-14; reverses DESIGN.md "Cursor" ("block cursor = native selection of the char under the cursor … No overlay") for contenteditable Fields only. Outside Insert and Visual, a contenteditable Field's native selection is a caret collapsed before the Cursor's character, and VimText draws the Cursor itself: a steady block over that character's rectangle (a bottom bar in Replace), in the Field's Status Line host, ignoring the mouse. The page's own caret is hidden while the block shows. Textarea and input Fields keep the one-character native selection.

Why: a page cannot tell a one-character selection from a person selecting a character. Every editor that opens a toolbar for a selection (Notion, Lexical's playground; #71) opened it after each Normal-mode move, over the lines around the Cursor, and a click on it acted on the Cursor's character. VimText cannot suppress a toolbar while a real selection exists, so the selection has to go. The same one-character selection was what a trusted line break replaced in #51, and what any page command acting on "the selection" (Ctrl+B, a paste handler, an AI action) took in Normal mode.

## Considered options

- **Accept it as a limitation**: every rich editor with a selection toolbar shows one over the text after every move; the most-used Sites (Notion) are among them.
- **A collapsed caret and nothing drawn**: fixes every toolbar, but the rich editors, where VimText matters most, lose the block Cursor and show only a thin caret indistinguishable from Insert, with the Mode left to the Status Line.

## Consequences

- Visual mode keeps the native selection: the person has selected text, and a toolbar over it is the page behaving as it should. No block is drawn at Visual's head.
- The block must follow what the native selection followed for free: VimText's renders, scrolling (capture phase, inner scrollers included), resizing, and the editor's own re-renders (mutations in the Field, one measurement per frame). It is clipped to the visible part of the Field.
- The page's caret is hidden through a constructed stylesheet adopted by the document (or the Field's shadow root) while the block shows, never by an attribute on the page's element, which the editors' observers would see.
- A host in the document's top layer (a modal `<dialog>`, a popover) paints over the Status Line host, and now over the Cursor too; putting the host in the top layer is its own work, shared with the Status Line.
- Replace mode becomes distinguishable on contenteditable Fields (a bottom bar); the accepted limitation remains for textarea and input Fields.
- #51's refusal of a trusted line break in Normal on a Single-line Field stays: with a collapsed caret the break no longer replaces a character, but it would still insert one.
