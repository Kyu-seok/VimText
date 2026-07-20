// dom/cursor.js — render the Vim cursor using the field's *native* selection.
//
// Per the design decision: instead of a mirror-div overlay we exploit the
// browser's own selection highlight.
//   NORMAL       -> select the single char under the cursor (block look)
//   VISUAL       -> select anchor..cursor (inclusive of the cursor char)
//   VISUAL LINE  -> select whole lines anchor..cursor
//   INSERT       -> a collapsed caret
// Empty line / end-of-text has no char to highlight, so we fall back to a
// collapsed caret there.

import { Mode, isVisual } from "../engine/state.js";
import { lineStart, lineEnd } from "../engine/motions.js";
import { setSelection } from "./write.js";

export function render(el, state, cursor) {
  const text = el.value;

  if (state.mode === Mode.INSERT) {
    setSelection(el, cursor, cursor);
    return;
  }

  if (isVisual(state.mode)) {
    const anchor = state.visualAnchor == null ? cursor : state.visualAnchor;
    if (state.mode === Mode.VISUAL_LINE) {
      const start = lineStart(text, Math.min(anchor, cursor));
      const end = lineEnd(text, Math.max(anchor, cursor));
      setSelection(el, start, end, "forward");
    } else {
      const start = Math.min(anchor, cursor);
      const end = Math.min(Math.max(anchor, cursor) + 1, text.length);
      setSelection(el, start, end, "forward");
    }
    return;
  }

  // NORMAL: block over the character under the cursor.
  const le = lineEnd(text, cursor);
  if (cursor < le && cursor < text.length) {
    setSelection(el, cursor, cursor + 1, "forward");
  } else {
    setSelection(el, cursor, cursor); // empty line / EOL
  }
}
