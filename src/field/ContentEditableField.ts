import type { Field, FieldSelection, WrappingStyle } from "./Field";
import { diffText, type TextDiff } from "./diff";
import { project } from "./projection";
import { readDomSelection, selectDom } from "./domSelection";
import { replaceDomRange } from "./editingCommands";

/**
 * The span a write replaces and what it inserts there. An edit that removes
 * text next to a space takes that space along and writes it back: Chrome's
 * `delete` drops the whitespace-only text node it would leave at the edge of a
 * block (`quick <b>brown</b>` minus `quick` loses the space), and the text
 * typed there next would join the bold run. A replacement that starts in the
 * plain text keeps that node, and `insertText` writes a no-break space where a
 * plain one would collapse (the projection reads it as a space). Only a space
 * the edit would leave at a line's edge is at risk and taken along: one taken
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
  const atLineStart = from === 0 || old[from - 1] === "\n";
  const atLineEnd = to === old.length || old[to] === "\n";
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
 */
export class ContentEditableField implements Field {
  readonly singleLine = false;
  private writing = false;
  private inputHandlers = new Set<() => void>();
  /** The last selection set or read inside the host, answered while the native one is elsewhere. */
  private lastSelection: FieldSelection = { anchor: 0, head: 0 };

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
    const span = breakAtLineEnd(old, keepAdjacentSpaces(old, diffText(old, text), text));
    this.writing = true;
    try {
      replaceDomRange(this.element, projection.toDom(span.from), projection.toDom(span.to), span.insert);
    } finally {
      this.writing = false;
    }
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
    selectDom(this.element, projection.toDom(a), projection.toDom(h));
    this.lastSelection = { anchor: a, head: h };
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
