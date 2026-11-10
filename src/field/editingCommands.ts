import type { DomPoint } from "./projection";
import { selectDom } from "./domSelection";

/**
 * Replaces the DOM between `from` and `to` with `text` the way typing would
 * (ADR 0007): the range is selected and the browser's own editing commands
 * run on it, so the page's editor applies the edit and its model stays the
 * truth. A `\n` is `insertParagraph` (what Enter makes in that editor), other
 * text `insertText`, a pure deletion `delete`; the first command replaces the
 * selection. No DOM node is touched here.
 *
 * Each step is followed by a `selectionchange` (see `settleEditor`).
 *
 * Returns false when the browser refused a command (no editable selection,
 * an editor that cancelled it).
 */
export function replaceDomRange(host: Element, from: DomPoint, to: DomPoint, text: string): boolean {
  selectDom(host, from, to);
  settleEditor(host);
  if (!text) return run(host, "delete");
  let ok = true;
  text.split("\n").forEach((part, i) => {
    if (i > 0) ok = run(host, "insertParagraph") && ok;
    if (part) ok = run(host, "insertText", part) && ok;
  });
  return ok;
}

function run(host: Element, command: string, value?: string): boolean {
  const ok = document.execCommand(command, false, value);
  settleEditor(host);
  return ok;
}

/**
 * Lets the page's editor catch up between steps, as it would between a
 * person's keys. The browser fires `selectionchange` only in a later task,
 * and an editor that reads its DOM changes in a MutationObserver callback
 * (ProseMirror) would read the whole write at once after it, with a stale
 * selection. Editors that track the selection listen for `selectionchange`,
 * and ProseMirror reads its pending DOM changes there too (`takeRecords`), so
 * announcing one after each step makes it take the selection before the
 * command (else a deletion before its old selection reads as Backspace and it
 * deletes that selection instead), apply a paragraph break as its own Enter
 * before the text that follows is typed (else the new block clones the
 * previous one's marks), and rewrite inside the write, where the bridge's
 * re-read sees it (docs/engine-seams.md, "Editor catch-up").
 */
function settleEditor(host: Element): void {
  host.ownerDocument.dispatchEvent(new Event("selectionchange"));
}

/**
 * Inserts an Atom's markup at the caret through the editor's own
 * `insertHTML`, the one editing command that can bring back an element
 * (an undone Atom deletion). Returns false when the browser refused it.
 */
export function insertAtomHtml(html: string): boolean {
  return document.execCommand("insertHTML", false, html);
}
