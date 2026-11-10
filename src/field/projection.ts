/**
 * The plain-text projection of a contenteditable editing host (DESIGN.md
 * "contenteditable Fields", _Projection_; ADR 0007): the text the engine sees,
 * one line per block, and the map between its offsets and DOM positions.
 * `innerText` is the oracle, with the departures docs/engine-seams.md lists
 * ("innerText as the oracle"): no blank line around a `<p>`, and no line for
 * a break that ends its block.
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
 * between pieces are the line breaks of block boundaries and the tabs between
 * table cells, which no node owns.
 *
 * - `text`: characters of one text node, `start + i` ↔ `(node, offsets[i])`.
 *   Not linear: a run of collapsed whitespace is one character spanning the
 *   whole run, and whitespace that renders as nothing has no character.
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
  /** A `text` piece's DOM offset of each of its `end - start + 1` boundaries, ascending. */
  offsets?: number[];
}

type Kind = "skip" | "text" | "br" | "block" | "cell" | "inline";

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
  if (display === "table-cell") return "cell";
  return isBlockDisplay(display) ? "block" : "inline";
}

/** Whether a rendered table cell comes before `cell` in its row. */
function followsCell(cell: Element): boolean {
  for (let n = cell.previousElementSibling; n; n = n.previousElementSibling) {
    if (kindOf(n) === "cell") return true;
  }
  return false;
}

/** How a text node's whitespace renders (CSS `white-space-collapse`). */
type Collapse = "collapse" | "preserve-breaks" | "preserve";

function collapseOf(node: Text): Collapse {
  const el = node.parentElement;
  if (!el) return "collapse";
  const cs = getComputedStyle(el);
  const v = cs.getPropertyValue("white-space-collapse") || cs.whiteSpace;
  if (v === "preserve-breaks" || v === "pre-line") return "preserve-breaks";
  if (v === "collapse" || v === "normal" || v === "nowrap" || !v) return "collapse";
  return "preserve";
}

/** One run of a text node as it renders, at DOM offset `at`. */
interface Run {
  /** A line break (a `\n` where breaks are preserved), collapsible whitespace, or characters that render one for one. */
  kind: "break" | "space" | "chars";
  at: number;
  text: string;
}

/** Document whitespace; U+00A0 is not, it never collapses. */
const RUN_PATTERNS: Record<Collapse, RegExp> = {
  collapse: /[ \t\n\r\f]+|[^ \t\n\r\f]+/g,
  "preserve-breaks": /\n|[ \t\r\f]+|[^\n \t\r\f]+/g,
  preserve: /\n|[^\n]+/g,
};

function runsOf(node: Text): Run[] {
  const mode = collapseOf(node);
  return [...node.data.matchAll(RUN_PATTERNS[mode])].map((m) => {
    const text = m[0];
    const kind =
      text === "\n" && mode !== "collapse"
        ? "break"
        : mode !== "preserve" && /^[ \t\n\r\f]/.test(text)
          ? "space"
          : "chars";
    return { kind, at: m.index, text };
  });
}

/**
 * Characters as the engine sees them, one for one. A no-break space is the
 * space it renders as: Chrome's editing commands write U+00A0 wherever a plain
 * space would collapse (a trailing space, one at a block's edge), so a space
 * VimText wrote reads back as one.
 */
function renderedText(data: string): string {
  return data.replace(/\u00a0/g, " ");
}

/** A line break waiting for content to follow it in its block: a `<br>` (a `node` piece) or a preserved `\n` (a `text` character). */
interface HeldBreak {
  kind: "node" | "text";
  from: DomPoint;
  to: DomPoint;
}

function indexIn(node: Node): number {
  return Array.prototype.indexOf.call(node.parentNode!.childNodes, node);
}

/**
 * Walks the host once. A block boundary after content asks for a line break
 * (`breakPending`), written only when more content follows, so leading and
 * trailing boundaries and the boundaries between nested blocks collapse to
 * one. A `<br>`, or a `\n` where breaks are preserved, is held (`heldBreak`)
 * until content follows it in its block: one that ends its block renders no
 * line (the block's placeholder) and is never a break.
 *
 * Collapsible whitespace renders as CSS lays it out: nothing at a line's
 * start, one space for a run (across inline elements too), nothing at a line's
 * end. So a space is held (`pendingSpace`) until content follows it on its line.
 */
class Walker {
  private text = "";
  readonly pieces: Piece[] = [];
  private breakPending = false;
  private heldBreak: HeldBreak | null = null;
  private pendingSpace: { node: Text; from: number; to: number } | null = null;
  /** Nothing has rendered on this line yet: a collapsible space here renders as nothing. */
  private lineStart = true;
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
      case "cell":
        return this.cell(node as Element);
      case "inline":
        for (const child of node.childNodes) this.walk(child);
    }
  }

  private textNode(node: Text): void {
    for (const run of runsOf(node)) {
      const at = { node, offset: run.at };
      if (run.kind === "break") this.lineBreak({ kind: "text", from: at, to: { node, offset: run.at + 1 } });
      else if (run.kind === "space") this.space(node, run);
      else this.chars(node, run);
    }
  }

  private space(node: Text, run: Run): void {
    if (this.lineStart || this.pendingSpace) return;
    this.pendingSpace = { node, from: run.at, to: run.at + run.text.length };
  }

  private chars(node: Text, run: Run): void {
    this.beforeContent();
    const space = this.pendingSpace;
    if (space) this.pushText(space.node, " ", [space.from, space.to]);
    const offsets = Array.from({ length: run.text.length + 1 }, (_, i) => run.at + i);
    this.pushText(node, renderedText(run.text), offsets);
    this.pendingSpace = null;
    this.lineStart = false;
  }

  private br(el: Element): void {
    const i = indexIn(el);
    const parent = el.parentNode!;
    this.lineBreak({ kind: "node", from: { node: parent, offset: i }, to: { node: parent, offset: i + 1 } });
  }

  private lineBreak(held: HeldBreak): void {
    if (this.heldBreak) this.beforeContent();
    this.heldBreak = held;
    this.newLine();
  }

  /** A line ends here: a held space renders as nothing, and so does one at the next line's start. */
  private newLine(): void {
    this.pendingSpace = null;
    this.lineStart = true;
  }

  private block(el: Element): void {
    this.heldBreak = null;
    this.newLine();
    this.breakPending = this.hasContent();
    this.blockHasContent.push(false);
    for (const child of el.childNodes) this.walk(child);
    const hadContent = this.blockHasContent.pop()!;
    if (!hadContent && this.heldBreak) {
      // An empty block holding its placeholder <br>: an empty line, as rendered.
      this.beforeContent(false);
      this.push("line", "", { node: el, offset: 0 }, { node: el, offset: el.childNodes.length });
    }
    if (hadContent || this.heldBreak) this.markContent();
    this.heldBreak = null;
    this.newLine();
    this.breakPending = this.hasContent();
  }

  /**
   * A table cell, as `innerText` reads it: its contents on its row's line (the
   * row is a block), and a tab before every cell after the first, which no
   * node owns. An empty cell is a zero-length `line` piece, so the cursor has a
   * position inside it.
   */
  private cell(el: Element): void {
    this.heldBreak = null;
    if (followsCell(el)) {
      this.beforeContent();
      this.text += "\t";
    }
    this.newLine();
    this.blockHasContent.push(false);
    for (const child of el.childNodes) this.walk(child);
    const hadContent = this.blockHasContent.pop()!;
    this.heldBreak = null;
    if (!hadContent) {
      this.beforeContent();
      this.push("line", "", { node: el, offset: 0 }, { node: el, offset: el.childNodes.length });
    }
    this.markContent();
    this.newLine();
  }

  private hasContent(): boolean {
    return this.text.length > 0 || this.pieces.length > 0;
  }

  /** Writes what content arriving now first needs: the held line break, or a block boundary's. */
  private beforeContent(releaseBr = true): void {
    if (releaseBr && this.heldBreak) {
      const { kind, from, to } = this.heldBreak;
      this.heldBreak = null;
      if (kind === "text") this.pushText(from.node as Text, "\n", [from.offset, to.offset]);
      else this.push("node", "\n", from, to);
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

  /** Appends characters of `node` at DOM `offsets`, extending the last piece when it ends where they start. */
  private pushText(node: Text, text: string, offsets: number[]): void {
    const last = this.pieces[this.pieces.length - 1];
    const first = offsets[0]!;
    const end = offsets[offsets.length - 1]!;
    if (
      last?.offsets &&
      last.from.node === node &&
      last.end === this.text.length &&
      last.to.offset === first
    ) {
      this.text += text;
      last.offsets.push(...offsets.slice(1));
      last.end = this.text.length;
      last.to = { node, offset: end };
      return;
    }
    const start = this.text.length;
    this.text += text;
    this.pieces.push({
      kind: "text",
      start,
      end: this.text.length,
      from: { node, offset: first },
      to: { node, offset: end },
      offsets,
    });
  }
}

/** The nearest block-level element around `node` inside `host`, or the host. */
function blockOf(node: Node, host: Element): Node {
  for (let n: Node | null = node; n && n !== host; n = n.parentNode) {
    if (isElement(n) && isBlockDisplay(getComputedStyle(n).display)) return n;
  }
  return host;
}

/**
 * The boundary of a `text` piece at or after DOM `offset`, the last if none: a
 * point inside a collapsed whitespace run reads as the end of the run.
 */
function boundaryAt(offsets: number[], offset: number): number {
  const i = offsets.findIndex((o) => o >= offset);
  return i < 0 ? offsets.length - 1 : i;
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
        return { node: p.from.node, offset: p.offsets![k - p.start]! };
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
          return node === p.from.node ? p.start + boundaryAt(p.offsets!, offset) : p.end;
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
