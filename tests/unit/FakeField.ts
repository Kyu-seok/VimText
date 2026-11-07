import type { Field, FieldSelection, WrappingStyle } from "../../src/field/Field";

/** What a Controlled Field's page keeps after a write: the text and where it leaves the caret. */
export interface Rewrite {
  text: string;
  caret?: number;
}

/**
 * A Field at the seam, with the page's side scripted by the test.
 *
 * `rewrite` plays a Controlled Field: the page rewrites the value synchronously
 * inside every write, as an uppercase filter or a mask does from its `input`
 * handler. `pageSet` plays a page that changes the Field with no event (the
 * rule-1 window); `pageInput` one that changes it and fires `input` (a
 * `setTimeout` reformat). Like the native value setter, every page write parks
 * the caret at the end unless the page says otherwise.
 */
export class FakeField implements Field {
  readonly element: HTMLElement;
  readonly singleLine: boolean;
  value: string;
  selection: FieldSelection = { anchor: 0, head: 0 };
  /** Applied synchronously inside `setValue`, after the bridge's text lands. */
  rewrite: ((text: string) => Rewrite) | null = null;
  /** Every text the bridge wrote, in order. */
  readonly writes: string[] = [];
  private focused = false;
  private inputHandlers = new Set<() => void>();

  constructor(value: string, opts: { singleLine?: boolean } = {}) {
    this.value = value;
    this.singleLine = opts.singleLine ?? false;
    this.element = document.createElement("div");
    document.body.appendChild(this.element);
  }

  getValue(): string {
    return this.value;
  }

  setValue(text: string): void {
    this.writes.push(text);
    this.value = text;
    this.selection = { anchor: text.length, head: text.length };
    if (this.rewrite) {
      const r = this.rewrite(text);
      if (r.text !== this.value) {
        this.value = r.text;
        const caret = r.caret ?? r.text.length;
        this.selection = { anchor: caret, head: caret };
      }
    }
  }

  /** The page sets the value with no event (React re-render, `el.value = …`). */
  pageSet(text: string, caret = text.length): void {
    this.value = text;
    this.selection = { anchor: caret, head: caret };
  }

  /** The page sets the value and fires `input` (a deferred reformat, native typing). */
  pageInput(text: string, caret = text.length): void {
    this.pageSet(text, caret);
    for (const h of this.inputHandlers) h();
  }

  getSelection(): FieldSelection {
    return { ...this.selection };
  }

  setSelection(anchor: number, head: number): void {
    const len = this.value.length;
    this.selection = { anchor: Math.max(0, Math.min(len, anchor)), head: Math.max(0, Math.min(len, head)) };
  }

  focus(): void {
    this.focused = true;
  }

  blur(): void {
    this.focused = false;
  }

  hasFocus(): boolean {
    return this.focused;
  }

  visibleLineCount(): number {
    return this.singleLine ? 1 : 10;
  }

  onInput(handler: () => void): () => void {
    this.inputHandlers.add(handler);
    return () => this.inputHandlers.delete(handler);
  }

  wrappingStyle(): WrappingStyle {
    return {
      font: "14px monospace",
      letterSpacing: "normal",
      lineHeight: "20px",
      contentWidth: 400,
      whiteSpace: this.singleLine ? "pre" : "pre-wrap",
      wordBreak: "normal",
      overflowWrap: "normal",
      tabSize: "8",
    };
  }

  isConnected(): boolean {
    return this.element.isConnected;
  }

  destroy(): void {
    this.inputHandlers.clear();
    this.element.remove();
  }
}
