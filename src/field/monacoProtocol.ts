/**
 * What VimText's content script and its page-world script say to each other
 * about a Monaco code editor (ADR 0010). Both are events on the element Monaco
 * focuses, their `detail` a JSON string: the content script dispatches a
 * request, the page-world script answers with an event on the same element
 * before that dispatch returns. Every offset counts the text with `\n` line
 * ends, whatever the model's own are.
 */
export const MONACO_REQUEST = "vimtext:monaco:request";
export const MONACO_ANSWER = "vimtext:monaco:answer";

/** One replacement: `from`..`to` of the text before the edits becomes `insert`. */
export interface MonacoEdit {
  from: number;
  to: number;
  insert: string;
}

export type MonacoRequest =
  /** The selection alone: the cheap question of whether the element's editor can be a Field. */
  | { op: "selection" }
  /** The editor's whole text and its selection. */
  | { op: "read" }
  /** The edits, as one step of the editor's undo stack. */
  | { op: "edit"; edits: MonacoEdit[] }
  /** Sets the selection, which leaves the editor one cursor, and scrolls its head into view. */
  | { op: "select"; anchor: number; head: number }
  /**
   * `block`: the editor's cursor style becomes a block, the style it had kept
   * for later. Not `block`: that style comes back.
   */
  | { op: "cursor"; block: boolean };

/**
 * All an answer may hold: the primary selection as offsets, and for `read` the
 * text. No answer at all means the element has no editor that can be a Field.
 */
export interface MonacoAnswer {
  anchor: number;
  head: number;
  text?: string;
}
