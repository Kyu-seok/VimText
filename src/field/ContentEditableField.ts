import type { Field, FieldSelection, WrappingStyle } from "./Field";
import { diffText, type TextDiff } from "./diff";
import { project, type Projection } from "./projection";
import { readDomSelection, selectDom } from "./domSelection";
import { insertAtomHtml, replaceDomRange } from "./editingCommands";
import { ATOM_CHAR, atomText } from "./atoms";

/** An Atom a write removed, kept so an undo that writes its U+FFFC back can restore the element. */
interface RemovedAtom {
  html: string;
  /** Its offset when removed, and the write's sequence number: the order a restore puts several back in. */
  offset: number;
  seq: number;
}

/** Holds an Atom's place while it is inserted (see `insertAtom`). */
const MARKER = "\u200b";

/** How many removed Atoms a Field keeps for undo; older ones come back as nothing. */
const REMOVED_ATOMS_KEPT = 200;

/**
 * The span a write replaces and what it inserts there. An edit that removes
 * text next to a space takes that space along and writes it back: Chrome's
 * `delete` drops the whitespace-only text node it would leave at the edge of a
 * block (`quick <b>brown</b>` minus `quick` loses the space), and the text
 * typed there next would join the bold run. A replacement that starts in the
 * plain text keeps that node, and `insertText` writes a no-break space where a
 * plain one would collapse (the projection reads it as a space).
 */
function keepAdjacentSpaces(
  old: string,
  diff: TextDiff,
  text: string,
): { from: number; to: number; insert: string } {
  let from = diff.start;
  let to = diff.endOld;
  let insert = text.slice(diff.start, diff.endNew);
  if (to === from) return { from, to, insert };
  if (old[to] === " ") {
    to++;
    insert += " ";
  }
  if (old[from - 1] === " ") {
    from--;
    insert = " " + insert;
  }
  return { from, to, insert };
}

/**
 * Field implementation for a contenteditable editing host (DESIGN.md
 * "contenteditable Fields", ADR 0007). Its text is the host's plain-text
 * projection (`project`), read afresh on every call so the page's editor is
 * always the truth; its selection is the native one mapped through the
 * projection. `setValue` writes only the span that differs, through the
 * browser's editing commands (`replaceDomRange`), never by mutating the DOM.
 */
export class ContentEditableField implements Field {
  readonly singleLine = false;
  private writing = false;
  private inputHandlers = new Set<() => void>();
  /** The last selection set or read inside the host, answered while the native one is elsewhere. */
  private lastSelection: FieldSelection = { anchor: 0, head: 0 };
  /** Atoms the bridge's writes removed, oldest first. */
  private removedAtoms: RemovedAtom[] = [];
  private writeSeq = 0;

  constructor(readonly element: HTMLElement) {
    element.addEventListener("input", this.handleInput);
  }

  private handleInput = () => {
    if (this.writing) return;
    for (const h of this.inputHandlers) h();
  };

  getValue(): string {
    return project(this.element).text;
  }

  setValue(text: string): void {
    const projection = project(this.element);
    const old = projection.text;
    if (old === text) return;
    const span = keepAdjacentSpaces(old, diffText(old, text), text);
    this.writing = true;
    try {
      const restored = this.takeRemovedAtoms(span.insert.split(ATOM_CHAR).length - 1);
      this.keepRemovedAtoms(projection, span.from, span.to);
      if (!span.insert.includes(ATOM_CHAR)) {
        replaceDomRange(this.element, projection.toDom(span.from), projection.toDom(span.to), span.insert);
      } else {
        this.writeWithAtoms(span.from, span.to, span.insert, restored);
      }
    } finally {
      this.writing = false;
    }
  }

  /** The Atoms in the text: each one's offset and the visible text a yank stores for it. */
  atoms(): { offset: number; text: string }[] {
    return project(this.element).atoms.map((a) => ({ offset: a.offset, text: atomText(a.element) }));
  }

  /**
   * Remembers the Atoms between `from` and `to` before a write removes them.
   * The engine's history holds only their U+FFFC, so this is where an undo
   * finds the element again: a restore takes the latest removals, in the
   * order a stack of undos gives them back.
   */
  private keepRemovedAtoms(projection: Projection, from: number, to: number): void {
    const seq = ++this.writeSeq;
    for (const a of projection.atoms) {
      if (a.offset >= from && a.offset < to)
        this.removedAtoms.push({ html: a.element.outerHTML, offset: a.offset, seq });
    }
    this.removedAtoms.splice(0, Math.max(0, this.removedAtoms.length - REMOVED_ATOMS_KEPT));
  }

  /**
   * The markup for `count` U+FFFC a write puts back, in text order: the last
   * `count` removals, sorted by where they were (a run of `x` removed each at
   * the same offset, oldest first; `X` walked backwards). Fewer when fewer
   * were kept: a U+FFFC with no element to restore is written as nothing, and
   * the Field's text, not the mirror's, then stands (a Controlled Field rewrite).
   */
  private takeRemovedAtoms(count: number): string[] {
    if (count === 0) return [];
    const taken = this.removedAtoms.splice(Math.max(0, this.removedAtoms.length - count));
    return taken.sort((a, b) => a.offset - b.offset || a.seq - b.seq).map((a) => a.html);
  }

  /** Writes `insert` over `from`..`to`, each U+FFFC as the next of `atoms` (none: nothing). */
  private writeWithAtoms(from: number, to: number, insert: string, atoms: string[]): void {
    const [first, ...rest] = insert.split(ATOM_CHAR);
    if (first || from !== to) {
      const p = project(this.element);
      replaceDomRange(this.element, p.toDom(from), p.toDom(to), first!);
    }
    let at = from + first!.length;
    rest.forEach((part, i) => {
      const html = atoms[i];
      if (html && this.insertAtom(at, html)) at++;
      if (!part) return;
      const caret = project(this.element).toDom(at);
      replaceDomRange(this.element, caret, caret, part);
      at += part.length;
    });
  }

  /**
   * Puts an Atom's element back at offset `at` through `insertHTML`, with a
   * marker character after it while it lands: Chrome moves a non-editable
   * element inserted at the end of a block out of that block, and leaves the
   * caret inside it, where no later editing command applies.
   */
  private insertAtom(at: number, html: string): boolean {
    const here = project(this.element).toDom(at);
    replaceDomRange(this.element, here, here, MARKER);
    const before = project(this.element).toDom(at);
    selectDom(this.element, before, before);
    insertAtomHtml(html);
    const p = project(this.element);
    if (p.text[at + 1] === MARKER) replaceDomRange(this.element, p.toDom(at + 1), p.toDom(at + 2), "");
    return project(this.element).text[at] === ATOM_CHAR;
  }

  getSelection(): FieldSelection {
    const sel = readDomSelection(this.element);
    if (!sel) return { ...this.lastSelection };
    const projection = project(this.element);
    this.lastSelection = {
      anchor: projection.fromDom(sel.anchor.node, sel.anchor.offset),
      head: projection.fromDom(sel.focus.node, sel.focus.offset),
    };
    return { ...this.lastSelection };
  }

  setSelection(anchor: number, head: number): void {
    const projection = project(this.element);
    const len = projection.text.length;
    const a = Math.max(0, Math.min(len, anchor));
    const h = Math.max(0, Math.min(len, head));
    this.lastSelection = { anchor: a, head: h };
    // A selection set inside a blurred host focuses it (docs/engine-seams.md,
    // Editing commands and events): it would take focus from the command
    // line, which closes on blur. The render on focus sets it.
    if (!this.hasFocus()) return;
    selectDom(this.element, projection.toDom(a), projection.toDom(h));
  }

  hasFocus(): boolean {
    return this.element.matches(":focus");
  }

  focus(): void {
    this.element.focus({ preventScroll: true });
  }

  blur(): void {
    this.element.blur();
  }

  visibleLineCount(): number {
    const cs = getComputedStyle(this.element);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2 || 16;
    const visible = Math.min(this.element.clientHeight, window.innerHeight);
    const inner = visible - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    return Math.max(1, Math.floor(inner / lh));
  }

  onInput(handler: () => void): () => void {
    this.inputHandlers.add(handler);
    return () => this.inputHandlers.delete(handler);
  }

  /** The host's base font: display-line motions approximate on mixed fonts (DESIGN.md accepted limitations). */
  wrappingStyle(): WrappingStyle {
    const cs = getComputedStyle(this.element);
    const contentWidth = this.element.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return {
      font: cs.font,
      letterSpacing: cs.letterSpacing,
      lineHeight: cs.lineHeight,
      contentWidth: Math.max(0, contentWidth),
      whiteSpace: "pre-wrap",
      wordBreak: cs.wordBreak,
      overflowWrap: cs.overflowWrap,
      tabSize: cs.tabSize,
    };
  }

  isConnected(): boolean {
    return this.element.isConnected;
  }

  destroy(): void {
    this.element.removeEventListener("input", this.handleInput);
    this.inputHandlers.clear();
  }
}
