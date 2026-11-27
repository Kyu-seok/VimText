/**
 * A Field is an editable element on the page that VimText can attach to.
 * This is the seam between the engine bridge and the DOM: the bridge only
 * ever talks to a Field, never to a textarea/input/contenteditable directly.
 */
import type { ChangeSet } from "@codemirror/state";

export interface FieldSelection {
  /** Offset where the selection started (the fixed end). */
  anchor: number;
  /** Offset of the moving end (where the caret is). */
  head: number;
}

export interface Field {
  readonly element: HTMLElement;
  /**
   * The element whose box is the Field's on the page, which the Status Line
   * sits under and the mirror takes its height from, where that is not
   * `element`: a Monaco Field's element is a one-line input at the caret, and
   * its box is the editor's. Absent on Fields whose element is their box.
   */
  boxElement?(): HTMLElement;
  /** True for fields that cannot hold a newline (single-line inputs). */
  readonly singleLine: boolean;
  getValue(): string;
  /**
   * True once after a `getValue()` found that the page replaced the Field's
   * document under VimText: a Monaco Field's editor flushed its model or
   * changed its language (ADR 0010; docs/engine-seams.md, "Monaco: changes
   * from outside"). The texts before it are no states to undo to, and the
   * Session forgets its undo history and marks. Absent on Fields where a
   * page's rewrite is a change like any other.
   */
  takeDocumentReplaced?(): boolean;
  /**
   * True on a Field whose element the page's editor makes anew, focus kept,
   * when it takes another document (a Monaco Field's on a swapped model;
   * docs/engine-seams.md, "Monaco: changes from outside"): `Sessions` carries
   * a Session's hold of the keys over to the element that took the focus.
   */
  readonly elementReplaced?: boolean;
  /**
   * Writes text in a way the host page's framework notices (React, Vue, …).
   * A textarea or input writes synchronously; a contenteditable host returns a
   * promise that resolves once the write has settled (ADR 0008), and the
   * caller makes no other write to it until then. `changes`, when the caller
   * has them, are the mirror's own changes from the Field's text to `text`: a
   * contenteditable Field reads from them which side of a boundary between
   * runs held the text they deleted (owner decision on #63; CODING_STANDARDS
   * rule 13), never from a diff of the texts.
   */
  setValue(text: string, changes?: ChangeSet): void | Promise<void>;
  getSelection(): FieldSelection;
  /**
   * `insertCaret`: the selection is the Insert caret (Insert or Replace mode),
   * which a contenteditable Field puts on the side of a boundary between two
   * runs of text that the owner decision on #63 names (docs/engine-seams.md,
   * "Marks at a write's edges"). A textarea has no runs and ignores it.
   */
  setSelection(anchor: number, head: number, insertCaret?: boolean): void;
  /**
   * True while the selection VimText last set may not be the page's editor's
   * yet (a contenteditable Field's; ADR 0008): a key typed natively then would
   * land at the editor's stale selection. Absent on Fields whose selection is
   * the browser's own.
   */
  selectionSettling?(): boolean;
  /**
   * The box, in the frame's viewport, VimText draws the Normal-mode Cursor
   * over when the Cursor is on offset `offset` (ADR 0009): the character's,
   * an Atom's whole box, at a line's end a box one `0` wide. Present only on
   * Fields whose selection outside Insert and Visual is a caret collapsed
   * before the Cursor's character (a contenteditable Field's); a textarea or
   * input selects the character instead. Null when nothing is laid out there.
   */
  cursorBox?(offset: number): DOMRect | null;
  /**
   * Has the page's editor draw the Normal-mode Cursor itself (a Monaco Field;
   * ADR 0010): a block over the character after its caret when `on`, the
   * cursor style the page had otherwise. Present only on such a Field, whose
   * selection outside Insert and Visual is a caret before the Cursor's
   * character, as with `cursorBox`.
   */
  showBlockCursor?(on: boolean): void;
  focus(): void;
  /**
   * Takes focus off the Field, leaving nothing in it highlighted. A Field
   * whose selection outlives its focus (a contenteditable host) leaves a caret
   * at `caret`, where focusing it again resumes; one whose selection stops
   * showing on blur ignores `caret`.
   */
  blur(caret: number): void;
  hasFocus(): boolean;
  /** Number of text lines that fit in the visible area (for Ctrl-d/u, zz, …). */
  visibleLineCount(): number;
  /** Fires on native user edits (typing, paste, native undo). Not on setValue(). */
  onInput(handler: () => void): () => void;
  /**
   * Cancels the browser's own line break in a Single-line contenteditable
   * Field while `when()` holds (#51, DESIGN.md Key Policy row 6): a trusted
   * `insertParagraph`/`insertLineBreak` the page did not cancel. Returns the
   * function that stops it. Absent on Fields where the browser inserts none.
   */
  refuseNativeBreaks?(when: () => boolean): () => void;
  /** Styles the mirror should copy so its line wrapping matches this Field. */
  wrappingStyle(): WrappingStyle;
  isConnected(): boolean;
  /**
   * The Atoms in the text (a contenteditable Field's; GLOSSARY.md): each
   * U+FFFC's offset and the visible text a register stores for it. Absent on
   * Fields that have none.
   */
  atoms?(): { offset: number; text: string }[];
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
