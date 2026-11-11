import type { Field, FieldSelection, WrappingStyle } from "./Field";
import { diffText, type TextDiff } from "./diff";
import { project, type Projection } from "./projection";
import { readDomSelection, selectDom } from "./domSelection";
import { insertAtomHtml, nextTask, replaceDomRange } from "./editingCommands";
import { ATOM_CHAR, atomText } from "./atoms";

/**
 * An Atom a write or the page's own editing removed, kept so an undo that
 * writes its U+FFFC back can restore the element.
 */
interface RemovedAtom {
  html: string;
  /** Its offset when removed: an undo writes its U+FFFC back at that same offset. */
  offset: number;
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
 * plain one would collapse (the projection reads it as a space). Only a space
 * the edit would leave at a line's or a table cell's edge is at risk and taken along: one taken
 * mid-line is written back in the style of the span's start, so `cw` on the
 * last word of a bold run would turn the plain space after it bold (#46).
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
  // A line's edge or a table cell's (cells join by a tab).
  const atLineStart = from === 0 || old[from - 1] === "\n" || old[from - 1] === "\t";
  const atLineEnd = to === old.length || old[to] === "\n" || old[to] === "\t";
  if (old[to] === " " && atLineStart) {
    to++;
    insert += " ";
  }
  if (old[from - 1] === " " && atLineEnd) {
    from--;
    insert = " " + insert;
  }
  return { from, to, insert };
}

/**
 * Whole lines added or removed are written at the end of the line above, as
 * Enter or Backspace there would. The diff places a linewise insertion
 * (`o`, a linewise `p`: `X\n` after a `\n`) at the start of the next line,
 * inside the next block, so it lands in the list below; and a linewise
 * deletion (`dd`: `X\n` after a `\n`) from the start of the line to the start
 * of the next, which merges the next block into this one's element (the
 * paragraph below a list becomes a list item). Sliding the span left by the
 * newline it ends with is the same text change: `\nX` at the end of the
 * line above, so a new block is the current line's kind and a removed line
 * leaves its neighbours in their own blocks.
 */
function breakAtLineEnd(
  old: string,
  span: { from: number; to: number; insert: string },
): { from: number; to: number; insert: string } {
  const { from, to, insert } = span;
  if (old[from - 1] !== "\n") return span;
  if (from === to && insert.endsWith("\n")) {
    return { from: from - 1, to: from - 1, insert: "\n" + insert.slice(0, -1) };
  }
  if (!insert && to > from && old[to - 1] === "\n") return { from: from - 1, to: to - 1, insert };
  return span;
}

/**
 * Field implementation for a contenteditable editing host (DESIGN.md
 * "contenteditable Fields", ADR 0007). Its text is the host's plain-text
 * projection (`project`), read afresh on every call so the page's editor is
 * always the truth; its selection is the native one mapped through the
 * projection. `setValue` writes only the span that differs, through the
 * browser's editing commands (`replaceDomRange`), never by mutating the DOM.
 *
 * A write is asynchronous (ADR 0008): its first step runs inside `setValue`,
 * each later one a task after the one before, and the promise resolves a task
 * after the last, once the editor has caught up. The host's `input` events
 * until then are the write's own. `destroy` stops a write between two steps,
 * and so does the host leaving the document.
 */
export class ContentEditableField implements Field {
  private writing = false;
  private destroyed = false;
  private inputHandlers = new Set<() => void>();
  /** The last selection set or read inside the host, answered while the native one is elsewhere. */
  private lastSelection: FieldSelection = { anchor: 0, head: 0 };
  /** Atoms removed from the host, oldest first. */
  private removedAtoms: RemovedAtom[] = [];
  /** The Atoms at the last read, so the page's own edit that removes one (an Insert-mode Backspace) is noticed. */
  private knownAtoms: { element: Element; offset: number }[] = [];

  /**
   * `singleLine` is the host's own declaration (`aria-multiline="false"`),
   * decided by `resolveField`: the Session then applies every Single-line rule.
   */
  constructor(
    readonly element: HTMLElement,
    readonly singleLine = false,
  ) {
    element.addEventListener("input", this.handleInput);
    this.noteAtoms(project(element));
  }

  private handleInput = () => {
    if (this.writing) return;
    const projection = project(this.element);
    const present = new Set(projection.atoms.map((a) => a.element));
    for (const a of this.knownAtoms) {
      if (!present.has(a.element)) this.keepRemovedAtom(a.element, a.offset);
    }
    this.noteAtoms(projection);
    for (const h of this.inputHandlers) h();
  };

  private noteAtoms(projection: Projection): void {
    this.knownAtoms = projection.atoms.map((a) => ({ element: a.element, offset: a.offset }));
  }

  getValue(): string {
    return project(this.element).text;
  }

  /** Resolves once the write has settled. One write at a time: the Session waits for one before the next. */
  setValue(text: string): Promise<void> {
    const projection = project(this.element);
    const old = projection.text;
    if (old === text) return Promise.resolve();
    const span = breakAtLineEnd(old, keepAdjacentSpaces(old, diffText(old, text), text));
    this.writing = true;
    const write = async (): Promise<void> => {
      try {
        const restored = this.takeRemovedAtoms(span.from, span.insert);
        this.keepRemovedAtoms(projection, span.from, span.to);
        if (!span.insert.includes(ATOM_CHAR)) {
          const [from, to] = [projection.toDom(span.from), projection.toDom(span.to)];
          await replaceDomRange(this.element, from, to, span.insert, this.pause);
        } else {
          await this.writeWithAtoms(span.from, span.to, span.insert, restored);
        }
        // The editor's answer to the last step (a re-render, a rewrite) is part of the write.
        await nextTask();
      } finally {
        this.writing = false;
        if (!this.destroyed) this.noteAtoms(project(this.element));
      }
    };
    return write();
  }

  /** The wait between two steps of a write: false once the write must stop (ADR 0008). */
  private pause = async (): Promise<boolean> => {
    await nextTask();
    return !this.destroyed && this.element.isConnected;
  };

  /** The Atoms in the text: each one's offset and the visible text a yank stores for it. */
  atoms(): { offset: number; text: string }[] {
    const projection = project(this.element);
    this.noteAtoms(projection);
    return projection.atoms.map((a) => ({ offset: a.offset, text: atomText(a.element) }));
  }

  /**
   * Remembers the Atoms between `from` and `to` before a write removes them.
   * The engine's history holds only their U+FFFC, so this is where an undo
   * finds the element again.
   */
  private keepRemovedAtoms(projection: Projection, from: number, to: number): void {
    for (const a of projection.atoms) {
      if (a.offset >= from && a.offset < to) this.keepRemovedAtom(a.element, a.offset);
    }
  }

  private keepRemovedAtom(element: Element, offset: number): void {
    this.removedAtoms.push({ html: element.outerHTML, offset });
    this.removedAtoms.splice(0, Math.max(0, this.removedAtoms.length - REMOVED_ATOMS_KEPT));
  }

  /**
   * The markup for each U+FFFC that `insert`, written at `from`, puts back:
   * the latest Atom removed at that U+FFFC's offset. An undo writes text back
   * where it was, every later change already undone, so the Atom removed
   * there is the one the U+FFFC stood for; a run of `x` removed each at the
   * same offset, and the undoes take them back newest first. A U+FFFC with no
   * Atom kept at its offset (a literal one, one past the limit) is
   * `undefined`, written as nothing, and the Field's text, not the mirror's,
   * then stands (a Controlled Field rewrite).
   */
  private takeRemovedAtoms(from: number, insert: string): (string | undefined)[] {
    const taken: (string | undefined)[] = [];
    for (let i = insert.indexOf(ATOM_CHAR); i >= 0; i = insert.indexOf(ATOM_CHAR, i + 1)) {
      let k = this.removedAtoms.length - 1;
      while (k >= 0 && this.removedAtoms[k]!.offset !== from + i) k--;
      taken.push(k < 0 ? undefined : this.removedAtoms.splice(k, 1)[0]!.html);
    }
    return taken;
  }

  /**
   * Writes `insert` over `from`..`to`, each U+FFFC as the next of `atoms`
   * (`undefined`: nothing). Each part is a step of its own, after a pause,
   * and re-projects the host the editor may have changed meanwhile.
   */
  private async writeWithAtoms(
    from: number,
    to: number,
    insert: string,
    atoms: (string | undefined)[],
  ): Promise<void> {
    const [first, ...rest] = insert.split(ATOM_CHAR);
    let started = false;
    if (first || from !== to) {
      started = true;
      const p = project(this.element);
      await replaceDomRange(this.element, p.toDom(from), p.toDom(to), first!, this.pause);
    }
    let at = from + first!.length;
    for (const [i, part] of rest.entries()) {
      const html = atoms[i];
      if (html) {
        if (started && !(await this.pause())) return;
        started = true;
        if (await this.insertAtom(at, html)) at++;
      }
      if (!part) continue;
      if (started && !(await this.pause())) return;
      started = true;
      const caret = project(this.element).toDom(at);
      await replaceDomRange(this.element, caret, caret, part, this.pause);
      at += part.length;
    }
  }

  /**
   * Puts an Atom's element back at offset `at` through `insertHTML`, with a
   * marker character after it while it lands: Chrome moves a non-editable
   * element inserted at the end of a block out of that block, and leaves the
   * caret inside it, where no later editing command applies.
   */
  private async insertAtom(at: number, html: string): Promise<boolean> {
    const here = project(this.element).toDom(at);
    await replaceDomRange(this.element, here, here, MARKER, this.pause);
    if (!(await this.pause())) return false;
    const before = project(this.element).toDom(at);
    selectDom(this.element, before, before);
    insertAtomHtml(html);
    if (!(await this.pause())) return false;
    const p = project(this.element);
    if (p.text[at + 1] === MARKER) {
      await replaceDomRange(this.element, p.toDom(at + 1), p.toDom(at + 2), "", this.pause);
    }
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
    this.destroyed = true;
    this.element.removeEventListener("input", this.handleInput);
    this.inputHandlers.clear();
  }
}
