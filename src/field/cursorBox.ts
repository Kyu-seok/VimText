import type { DomPoint, Projection } from "./projection";

/**
 * The box VimText draws a contenteditable Field's Normal-mode Cursor over
 * (ADR 0009, DESIGN.md "Cursor"), measured from the page's layout without
 * selecting anything:
 *
 * - an Atom: its element's whole box;
 * - a character: its Range's last client rect with a width (a character split
 *   by a soft wrap has more than one; a tab has one, its whole advance). A
 *   collapsible space at a soft wrap has only zero-width rects, one at each
 *   line's edge (docs/engine-seams.md, "Measuring the drawn Cursor"): the
 *   first, at the end of the line the space ends, one `0` wide;
 * - a line's end (an empty line, Replace past a line's last character): the
 *   caret's place there, one `0` wide in the font at that point. A collapsed
 *   Range in an empty block has no client rects, so its placeholder `<br>`'s
 *   box gives the place, and failing that the block's content edge.
 */
export function cursorBoxAt(host: HTMLElement, projection: Projection, offset: number): DOMRect | null {
  const text = projection.text;
  const at = Math.max(0, Math.min(text.length, offset));
  const atom = projection.atoms.find((a) => a.offset === at);
  if (atom) return atom.element.getBoundingClientRect();
  const doc = host.ownerDocument;
  if (at < text.length && text[at] !== "\n") {
    const from = projection.toDom(at);
    const to = projection.toDom(at + 1, "before");
    const range = doc.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    const rects = [...range.getClientRects()];
    const solid = rects.filter((r) => r.width > 0).at(-1);
    if (solid) return DOMRect.fromRect(solid);
    if (rects[0]) return oneZeroWide(rects[0], from);
  }
  return lineEndBox(host, projection.toDom(at));
}

function lineEndBox(host: HTMLElement, point: DomPoint): DOMRect | null {
  const doc = host.ownerDocument;
  const range = doc.createRange();
  range.setStart(point.node, point.offset);
  const caret = range.getClientRects()[0];
  if (caret) return oneZeroWide(caret, point);
  // An empty block: its placeholder `<br>` holds the line's place.
  const child = point.node.nodeType === Node.ELEMENT_NODE ? point.node.childNodes[point.offset] : undefined;
  if (child instanceof Element && child.localName === "br") {
    range.selectNode(child);
    const br = range.getClientRects()[0];
    if (br) return oneZeroWide(br, point);
  }
  const block = elementOf(point) ?? host;
  const r = block.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  const cs = getComputedStyle(block);
  const left = r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
  const top = r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
  const height = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2 || 16;
  return new DOMRect(left, top, zeroWidth(block), height);
}

function elementOf(point: DomPoint): Element | null {
  return point.node instanceof Element ? point.node : point.node.parentElement;
}

/** `rect`'s place and height, one `0` wide in the font at `point`. */
function oneZeroWide(rect: DOMRect, point: DomPoint): DOMRect {
  const el = elementOf(point);
  return new DOMRect(rect.left, rect.top, el ? zeroWidth(el) : 8, rect.height);
}

let canvas: CanvasRenderingContext2D | null = null;

/** The width of `0` in `el`'s font: Vim's block on an empty line is one character wide. */
function zeroWidth(el: Element): number {
  canvas ??= document.createElement("canvas").getContext("2d");
  if (!canvas) return 8;
  const cs = getComputedStyle(el);
  canvas.font = cs.font;
  return canvas.measureText("0").width || parseFloat(cs.fontSize) * 0.6 || 8;
}
