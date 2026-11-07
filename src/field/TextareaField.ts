import type { Field, FieldSelection, TextControl, WrappingStyle } from "./Field";

const textareaValueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
const inputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

/**
 * Field implementation for <textarea> and single-line <input> elements.
 *
 * Writes go through the native prototype setter plus a synthetic `input`
 * event so framework-controlled inputs (React, Vue) accept the edit instead
 * of reverting it on their next render.
 */
export class TextareaField implements Field {
  readonly singleLine: boolean;
  private writing = false;
  private inputHandlers = new Set<() => void>();

  constructor(readonly element: TextControl) {
    this.singleLine = element instanceof HTMLInputElement;
    element.addEventListener("input", this.handleInput);
  }

  private handleInput = () => {
    if (this.writing) return;
    for (const h of this.inputHandlers) h();
  };

  getValue(): string {
    return this.element.value;
  }

  setValue(text: string): void {
    if (this.element.value === text) return;
    this.writing = true;
    try {
      const setter = this.element instanceof HTMLTextAreaElement ? textareaValueSetter : inputValueSetter;
      setter.call(this.element, text);
      this.element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    } finally {
      this.writing = false;
    }
  }

  getSelection(): FieldSelection {
    const { selectionStart, selectionEnd, selectionDirection } = this.element;
    const start = selectionStart ?? 0;
    const end = selectionEnd ?? start;
    return selectionDirection === "backward" ? { anchor: end, head: start } : { anchor: start, head: end };
  }

  setSelection(anchor: number, head: number): void {
    const len = this.element.value.length;
    const a = Math.max(0, Math.min(len, anchor));
    const h = Math.max(0, Math.min(len, head));
    const cur = this.getSelection();
    if (cur.anchor === a && cur.head === h) return;
    this.element.setSelectionRange(Math.min(a, h), Math.max(a, h), h < a ? "backward" : "forward");
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
    if (this.singleLine) return 1;
    const cs = getComputedStyle(this.element);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2 || 16;
    const inner = this.element.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    return Math.max(1, Math.floor(inner / lh));
  }

  onInput(handler: () => void): () => void {
    this.inputHandlers.add(handler);
    return () => this.inputHandlers.delete(handler);
  }

  wrappingStyle(): WrappingStyle {
    const cs = getComputedStyle(this.element);
    const contentWidth = this.element.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return {
      font: cs.font,
      letterSpacing: cs.letterSpacing,
      lineHeight: cs.lineHeight,
      contentWidth: Math.max(0, contentWidth),
      whiteSpace: this.singleLine ? "pre" : cs.whiteSpace === "nowrap" ? "pre" : "pre-wrap",
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
