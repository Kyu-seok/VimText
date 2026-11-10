/**
 * A Field is an editable element on the page that VimText can attach to.
 * This is the seam between the engine bridge and the DOM: the bridge only
 * ever talks to a Field, never to a textarea/input/contenteditable directly.
 */
export interface FieldSelection {
  /** Offset where the selection started (the fixed end). */
  anchor: number;
  /** Offset of the moving end (where the caret is). */
  head: number;
}

export interface Field {
  readonly element: HTMLElement;
  /** True for fields that cannot hold a newline (single-line inputs). */
  readonly singleLine: boolean;
  getValue(): string;
  /** Writes text in a way the host page's framework notices (React, Vue, …). */
  setValue(text: string): void;
  getSelection(): FieldSelection;
  setSelection(anchor: number, head: number): void;
  focus(): void;
  blur(): void;
  hasFocus(): boolean;
  /** Number of text lines that fit in the visible area (for Ctrl-d/u, zz, …). */
  visibleLineCount(): number;
  /** Fires on native user edits (typing, paste, native undo). Not on setValue(). */
  onInput(handler: () => void): () => void;
  /** Styles the mirror should copy so its line wrapping matches this Field. */
  wrappingStyle(): WrappingStyle;
  isConnected(): boolean;
  /** Stops listening to the page; the Session that used it is already destroyed. */
  destroy(): void;
}

export interface WrappingStyle {
  font: string;
  letterSpacing: string;
  lineHeight: string;
  /** Inner content width in CSS px (clientWidth minus horizontal padding). */
  contentWidth: number;
  whiteSpace: string;
  wordBreak: string;
  overflowWrap: string;
  tabSize: string;
}

export type TextControl = HTMLTextAreaElement | HTMLInputElement;
