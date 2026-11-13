import type { DomPoint } from "./projection";

/**
 * The native selection as a contenteditable Field reads and writes it: the one
 * place that knows which Selection object holds a host's caret.
 *
 * For a host in an open shadow root the document's selection is retargeted:
 * its anchor and focus read as the shadow host, never the nodes inside. Chromium's
 * `ShadowRoot.getSelection()` reads the same selection unretargeted, with its
 * direction (`getComposedRanges` gives a direction-less range). Writing needs no
 * such care: the document's `setBaseAndExtent` takes nodes inside the shadow tree.
 */

/** The Selection that reports positions inside `host`'s tree. */
export function selectionFor(host: Element): Selection | null {
  const root = host.getRootNode();
  if (!(root instanceof ShadowRoot)) return document.getSelection();
  const shadow = root as ShadowRoot & { getSelection?: () => Selection | null };
  return shadow.getSelection ? shadow.getSelection() : document.getSelection();
}

/** The selection's two ends inside `host`, or null when the selection lies outside it. */
export function readDomSelection(host: Element): { anchor: DomPoint; focus: DomPoint } | null {
  const sel = selectionFor(host);
  if (!sel || !sel.anchorNode || !sel.focusNode) return null;
  if (!host.contains(sel.anchorNode) || !host.contains(sel.focusNode)) return null;
  return {
    anchor: { node: sel.anchorNode, offset: sel.anchorOffset },
    focus: { node: sel.focusNode, offset: sel.focusOffset },
  };
}

/** Selects from `anchor` to `focus` (either order), unless that is already the selection. */
export function selectDom(host: Element, anchor: DomPoint, focus: DomPoint): void {
  const sel = document.getSelection();
  if (!sel) return;
  const current = selectionFor(host);
  if (
    current &&
    current.anchorNode === anchor.node &&
    current.anchorOffset === anchor.offset &&
    current.focusNode === focus.node &&
    current.focusOffset === focus.offset
  )
    return;
  sel.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
}
