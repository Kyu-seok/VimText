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
 * Returns false when the browser refused a command (no editable selection,
 * an editor that cancelled it).
 */
export function replaceDomRange(host: Element, from: DomPoint, to: DomPoint, text: string): boolean {
  selectDom(host, from, to);
  if (!text) return document.execCommand("delete");
  let ok = true;
  text.split("\n").forEach((part, i) => {
    if (i > 0) ok = document.execCommand("insertParagraph") && ok;
    if (part) ok = document.execCommand("insertText", false, part) && ok;
  });
  return ok;
}
