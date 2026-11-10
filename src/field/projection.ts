/**
 * The plain-text projection of a contenteditable editing host (DESIGN.md
 * "contenteditable Fields", _Projection_; ADR 0007): the text the engine sees,
 * one line per block, and the map between its offsets and DOM positions.
 *
 * One walker produces both, so a line break in the text and a DOM position in
 * the map can never disagree. The walk classifies each node (`kindOf`) and
 * hands it to one handler per kind: a new rule (an Atom, `white-space: pre`,
 * a table row) is a new kind and its handler, not an edit to the others.
 */

/** A DOM boundary point: a child index in an element, or a character offset in a text node. */
export interface DomPoint {
  node: Node;
  offset: number;
}

export interface Projection {
  readonly text: string;
  /** The DOM position of a text offset, clamped to the text. */
  toDom(offset: number): DomPoint;
  /** The text offset of a DOM position inside the host. */
  fromDom(node: Node, offset: number): number;
}

/**
 * One stretch of the text and the DOM it came from. The one-character gaps
 * between pieces are the line breaks of block boundaries, which no node owns.
 *
 * - `text`: characters of one text node, `start + i` ↔ `(node, i)`.
 * - `node`: one element standing for one character (a `<br>`'s `\n`): `start`
 *   ↔ before it, `end` ↔ after it.
 * - `line`: an empty block (`<p><br></p>`), zero characters: its offset ↔ `(block, 0)`.
 */
interface Piece {
  kind: "text" | "node" | "line";
  start: number;
  end: number;
  from: DomPoint;
  to: DomPoint;
}

type Kind = "skip" | "text" | "br" | "block" | "inline";

function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

function isBlockDisplay(display: string): boolean {
  return !(display.startsWith("inline") || display === "contents" || display.startsWith("ruby"));
}

function kindOf(node: Node): Kind {
  if (node.nodeType === Node.TEXT_NODE) return "text";
  if (!isElement(node)) return "skip";
  const display = getComputedStyle(node).display;
  if (display === "none") return "skip";
  if (node.localName === "br") return "br";
  return isBlockDisplay(display) ? "block" : "inline";
}

/**
 * A text node's characters as the engine sees them, one for one (the offset
 * map of a `text` piece is linear). A no-break space is the space it renders
 * as: Chrome's editing commands write U+00A0 wherever a plain space would
 * collapse (a trailing space, one at a block's edge), so a space VimText wrote
 * reads back as one.
 */
function renderedText(data: string): string {
  return data.replace(/ /g, " ");
}

function indexIn(node: Node): number {
  return Array.prototype.indexOf.call(node.parentNode!.childNodes, node);
}

/**
 * Walks the host once. A block boundary after content asks for a line break
 * (`breakPending`), written only when more content follows, so leading and
 * trailing boundaries and the boundaries between nested blocks collapse to
 * one. A `<br>` is held (`heldBr`) until content follows it in its block: one
 * that ends its block is that block's placeholder and never a break.
 */
class Walker {
  private text = "";
  readonly pieces: Piece[] = [];
  private breakPending = false;
  private heldBr: Element | null = null;
  /** Per open block, innermost last: whether it has projected anything yet. */
  private readonly blockHasContent: boolean[] = [];

  walkHost(host: Element): string {
    this.blockHasContent.push(false);
    for (const child of host.childNodes) this.walk(child);
    return this.text;
  }

  private walk(node: Node): void {
    switch (kindOf(node)) {
      case "skip":
        return;
      case "text":
        return this.textNode(node as Text);
      case "br":
        return this.br(node as Element);
      case "block":
        return this.block(node as Element);
      case "inline":
        for (const child of node.childNodes) this.walk(child);
    }
  }

  private textNode(node: Text): void {
    if (!node.data) return;
    this.beforeContent();
    this.push("text", renderedText(node.data), { node, offset: 0 }, { node, offset: node.data.length });
  }

  private br(el: Element): void {
    if (this.heldBr) this.beforeContent();
    this.heldBr = el;
  }

  private block(el: Element): void {
    this.heldBr = null;
    this.breakPending = this.hasContent();
    this.blockHasContent.push(false);
    for (const child of el.childNodes) this.walk(child);
    const hadContent = this.blockHasContent.pop()!;
    if (!hadContent && this.heldBr) {
      // An empty block holding its placeholder <br>: an empty line, as rendered.
      this.beforeContent(false);
      this.push("line", "", { node: el, offset: 0 }, { node: el, offset: el.childNodes.length });
    }
    if (hadContent || this.heldBr) this.markContent();
    this.heldBr = null;
    this.breakPending = this.hasContent();
  }

  private hasContent(): boolean {
    return this.text.length > 0 || this.pieces.length > 0;
  }

  /** Writes what content arriving now first needs: the held `<br>`'s break, or a block boundary's. */
  private beforeContent(releaseBr = true): void {
    if (releaseBr && this.heldBr) {
      const br = this.heldBr;
      this.heldBr = null;
      const i = indexIn(br);
      this.push("node", "\n", { node: br.parentNode!, offset: i }, { node: br.parentNode!, offset: i + 1 });
    } else if (this.breakPending && this.hasContent()) {
      this.text += "\n";
    }
    this.breakPending = false;
    this.markContent();
  }

  private markContent(): void {
    this.blockHasContent[this.blockHasContent.length - 1] = true;
  }

  private push(kind: Piece["kind"], text: string, from: DomPoint, to: DomPoint): void {
    const start = this.text.length;
    this.text += text;
    this.pieces.push({ kind, start, end: this.text.length, from, to });
  }
}

/** The nearest block-level element around `node` inside `host`, or the host. */
function blockOf(node: Node, host: Element): Node {
  for (let n: Node | null = node; n && n !== host; n = n.parentNode) {
    if (isElement(n) && isBlockDisplay(getComputedStyle(n).display)) return n;
  }
  return host;
}

/** Reads the projection of `host` as it is now. */
export function project(host: Element): Projection {
  const walker = new Walker();
  const text = walker.walkHost(host);
  const pieces = walker.pieces;
  const range = document.createRange();

  /** <0 when `a` is before `b`, 0 when equal, >0 after (document order of boundary points). */
  function compare(a: DomPoint, b: DomPoint): number {
    range.setStart(a.node, a.offset);
    range.collapse(true);
    return -range.comparePoint(b.node, b.offset);
  }

  function toDom(offset: number): DomPoint {
    const k = Math.max(0, Math.min(text.length, offset));
    // The last piece starting at or before k: at a boundary shared by two
    // pieces, the one the character at k belongs to.
    let lo = 0;
    let hi = pieces.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pieces[mid]!.start <= k) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (found < 0) return { node: host, offset: 0 };
    const p = pieces[found]!;
    if (k > p.end) return p.to;
    switch (p.kind) {
      case "text":
        return { node: p.from.node, offset: k - p.start };
      case "node":
        return k === p.start ? p.from : p.to;
      case "line":
        return p.from;
    }
  }

  function fromDom(node: Node, offset: number): number {
    const point = { node, offset };
    // The first piece that does not end before the point.
    let lo = 0;
    let hi = pieces.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (compare(pieces[mid]!.to, point) < 0) lo = mid + 1;
      else hi = mid;
    }
    const p = pieces[lo];
    if (!p) return text.length;
    if (compare(point, p.from) >= 0) {
      switch (p.kind) {
        case "text":
          return node === p.from.node ? p.start + Math.min(offset, p.end - p.start) : p.end;
        case "node":
          return compare(point, p.from) === 0 ? p.start : p.end;
        case "line":
          return p.start;
      }
    }
    // Between pieces: across a line break the point belongs to the line whose block holds it.
    const prev = pieces[lo - 1];
    if (prev && prev.end < p.start && !blockOf(p.from.node, host).contains(node)) return prev.end;
    return p.start;
  }

  return { text, toDom, fromDom };
}
