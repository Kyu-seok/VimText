import type { DomPoint } from "./projection";
import { readDomSelection, selectDom } from "./domSelection";

/**
 * Resolves in a later task (a message on a fresh channel: no timer clamping),
 * the spacing between the steps of a contenteditable write (ADR 0008).
 */
export function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/**
 * Waits between two steps of a write; resolves false when the write must stop
 * there (its Field was destroyed, its host left the document).
 */
export type Pause = () => Promise<boolean>;

/**
 * Replaces the DOM between `from` and `to` with `text` the way typing would
 * (ADR 0007, ADR 0008): the range is selected and each step is offered to the
 * page's editor as a synthetic `beforeinput`, the browser's own editing
 * command running only if the editor did not take it, so the page's editor
 * applies the edit and its model stays the truth. A `\n` is `insertParagraph`
 * (what Enter makes in that editor), other text `insertText`, a pure deletion
 * `delete`; the first step replaces the selection. No DOM node is touched here.
 *
 * Each step is followed by a `selectionchange` (see `settleEditor`). The first
 * step runs before this returns its promise; each later one waits on `pause`
 * (ADR 0008: the steps are spaced so the editor catches up), and none runs
 * once `pause` says stop.
 *
 * Resolves false when the browser refused a command (no editable selection,
 * an editor that cancelled it) or the write stopped.
 */
export async function replaceDomRange(
  host: Element,
  from: DomPoint,
  to: DomPoint,
  text: string,
  pause: Pause,
): Promise<boolean> {
  selectDom(host, from, to);
  settleEditor(host);
  if (!text) return run(host, "delete");
  const steps: [string, string?][] = [];
  text.split("\n").forEach((part, i) => {
    if (i > 0) steps.push(["insertParagraph"]);
    if (part) steps.push(["insertText", part]);
  });
  let ok = true;
  for (const [i, [command, value]] of steps.entries()) {
    if (i > 0 && !(await pause())) return false;
    ok = run(host, command, value) && ok;
  }
  return ok;
}

/** The `inputType` a step offers the editor (ADR 0008): any deletion is `deleteContentBackward`, never `deleteContent`, which Lexical and Slate cancel and drop. */
const INPUT_TYPE: Record<string, string> = {
  insertText: "insertText",
  insertParagraph: "insertParagraph",
  delete: "deleteContentBackward",
};

/**
 * One step of a write (ADR 0008): the editor is offered the edit as a
 * cancelable synthetic `beforeinput` on the host, its target the selected
 * range; only if no listener cancelled it does the browser's own editing
 * command run. Either way a `selectionchange` follows. An editor that
 * cancelled it applies the edit itself (or not: a Refused Edit, judged from
 * the projection once the write has settled).
 */
function run(host: Element, command: string, value?: string): boolean {
  const offered = new InputEvent("beforeinput", {
    inputType: INPUT_TYPE[command],
    data: command === "insertText" ? value : null,
    bubbles: true,
    cancelable: true,
    composed: true,
    targetRanges: selectedRange(host),
  });
  const ok = host.dispatchEvent(offered) ? document.execCommand(command, false, value) : true;
  settleEditor(host);
  return ok;
}

/** The selection inside `host` as a `StaticRange`, start before end; none when it lies outside. */
function selectedRange(host: Element): StaticRange[] {
  const sel = readDomSelection(host);
  if (!sel) return [];
  let [start, end] = [sel.anchor, sel.focus];
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  if (range.comparePoint(end.node, end.offset) < 0) [start, end] = [end, start];
  return [
    new StaticRange({
      startContainer: start.node,
      startOffset: start.offset,
      endContainer: end.node,
      endOffset: end.offset,
    }),
  ];
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
export function settleEditor(host: Element): void {
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
