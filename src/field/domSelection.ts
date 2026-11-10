import type { DomPoint } from "./projection";

/**
 * The native selection as a contenteditable Field reads and writes it: the one
 * place that knows which Selection object holds a host's caret (the
 * document's; a host in a shadow root is where a shadow-aware read belongs).
 */

/** The selection's two ends inside `host`, or null when the selection lies outside it. */
export function readDomSelection(host: Element): { anchor: DomPoint; focus: DomPoint } | null {
  const sel = document.getSelection();
  if (!sel || !sel.anchorNode || !sel.focusNode) return null;
  if (!host.contains(sel.anchorNode) || !host.contains(sel.focusNode)) return null;
  return {
    anchor: { node: sel.anchorNode, offset: sel.anchorOffset },
    focus: { node: sel.focusNode, offset: sel.focusOffset },
  };
}

/** Selects from `anchor` to `focus` (either order), unless that is already the selection. */
export function selectDom(_host: Element, anchor: DomPoint, focus: DomPoint): void {
  const sel = document.getSelection();
  if (!sel) return;
  if (
    sel.anchorNode === anchor.node &&
    sel.anchorOffset === anchor.offset &&
    sel.focusNode === focus.node &&
    sel.focusOffset === focus.offset
  )
    return;
  sel.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
}
