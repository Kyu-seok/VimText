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
 * Waits between two steps of a write, or before a write selects its range;
 * resolves false when the write must stop there (its Field was destroyed, its
 * host left the document).
 */
type Pause = () => Promise<boolean>;

/** How the Field spaces a write (ADR 0008). */
export interface Pauses {
  /** Between two steps, and between selecting the range and the first step. */
  step: Pause;
  /** Before selecting the range again: until the editor has settled from the host's last change. */
  settle: Pause;
}

/**
 * How many times a write selects its range when the editor put its own
 * selection back before the first step. Slate's case below needs a second;
 * the bound keeps a page that always moves the selection from holding a write.
 */
const SELECT_ATTEMPTS = 3;

/** A write of `text` over the DOM between `from` and `to`. */
export interface DomEdit {
  from: DomPoint;
  to: DomPoint;
  text: string;
  /**
   * Where the write continues once it has written `written` characters, read
   * after the editor's re-render: the caret is put there after a paragraph
   * break (`placeCaret`). None leaves the caret where it is.
   */
  caretAfter?: (written: number) => DomPoint | null;
}

/** One editing command of a write. */
type Step = { command: "insertText"; text: string } | { command: "insertParagraph" } | { command: "delete" };

/**
 * Replaces the DOM between `from` and `to` with `text` the way typing would
 * (ADR 0007, ADR 0008): the range is selected and each step is offered to the
 * page's editor as a synthetic `beforeinput`, the browser's own editing
 * command running only if the editor did not take it, so the page's editor
 * applies the edit and its model stays the truth. A `\n` is `insertParagraph`
 * (what Enter makes in that editor), other text `insertText`, a pure deletion
 * `delete`; the first step replaces the selection. No DOM node is touched here.
 *
 * The caller projects the range once the editor has settled from the host's
 * last change, and the first step waits a task after it is selected
 * (`pauses.step`) for the editor to take that selection. Slate takes a
 * selection on a throttled timer: one it took just before the write, not yet
 * rendered by React, makes it read no selection at the step's `beforeinput`
 * (its node map is dirty) and apply the step at the one it took, and its
 * render then puts that selection back into the DOM. So when the selection
 * after that task is not the range, the range is selected again once the
 * editor has settled (`pauses.settle`). Without this `dw` deleted only the
 * Normal cursor's character, and `cw` only its first (tests/e2e/slate.spec.ts,
 * "dw on a whole bold word", "x r cw inside the bold run"; docs/engine-seams.md,
 * "Slate takes a selection late").
 *
 * Each step is followed by a `selectionchange` (see `settleEditor`) and each
 * later step waits on `pauses.step` (ADR 0008: the steps are spaced so the
 * editor catches up). Nothing more runs once a pause says stop.
 *
 * A paragraph break that changed nothing in the host by the next step, nor
 * within `BREAK_WAIT_MS` after, was refused: the write stops before the text
 * after it.
 *
 * Resolves false when the browser refused a command (no editable selection,
 * an editor that cancelled it) or the write stopped.
 */
export async function replaceDomRange(host: Element, edit: DomEdit, pauses: Pauses): Promise<boolean> {
  const { from, to, text, caretAfter } = edit;
  for (let attempt = 1; ; attempt++) {
    selectDom(host, from, to);
    settleEditor(host);
    if (!(await pauses.step())) return false;
    if (attempt === SELECT_ATTEMPTS || isSelected(host, from, to)) break;
    if (!(await pauses.settle())) return false;
    // The editor re-rendered the range away: the write stops, and is judged.
    if (!host.contains(from.node) || !host.contains(to.node)) return false;
  }
  if (!text) return run(host, { command: "delete" });
  const steps: Step[] = [];
  text.split("\n").forEach((part, i) => {
    if (i > 0) steps.push({ command: "insertParagraph" });
    if (part) steps.push({ command: "insertText", text: part });
  });
  let ok = true;
  let written = 0;
  let breakChanged: ((wait?: boolean) => Promise<boolean>) | null = null;
  for (const [i, step] of steps.entries()) {
    if (i > 0 && !(await pauses.step())) return false;
    if (breakChanged) {
      // A break the editor cancelled and never made (Notion): the text after
      // it would join the line it was to open (#73). The write stops here.
      if (!(await breakChanged())) return false;
      if (!(await placeCaret(host, caretAfter?.(written), pauses))) return false;
    }
    breakChanged = step.command === "insertParagraph" ? watchChanges(host) : null;
    ok = run(host, step) && ok;
    written += step.command === "insertText" ? step.text.length : 1;
  }
  void breakChanged?.(false);
  return ok;
}

/**
 * How long a paragraph break that has changed nothing in the host by the next
 * step is still waited for. Slate makes a break it took over only when React
 * renders, which can come more than the step's one task later
 * (tests/e2e/slate.spec.ts, "o and linewise p"); Notion never makes one. Only
 * a refused break, or a late one, waits.
 */
const BREAK_WAIT_MS = 100;

/**
 * Starts watching `host`'s DOM; the function returned tells whether anything
 * in it changed since, waiting up to `BREAK_WAIT_MS` for a change when none
 * has come yet (unless `wait` is false), and stops watching. A page that changes its DOM for its own
 * reasons reads as changed: the check only ever lets a write on.
 */
function watchChanges(host: Element): (wait?: boolean) => Promise<boolean> {
  let changed = false;
  let onChange = (): void => {};
  const observer = new MutationObserver(() => {
    changed = true;
    onChange();
  });
  observer.observe(host, { childList: true, characterData: true, subtree: true });
  return async (wait = true) => {
    if (observer.takeRecords().length) changed = true;
    if (!changed && wait) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, BREAK_WAIT_MS);
        onChange = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
    observer.disconnect();
    return changed;
  };
}

/**
 * Puts the caret at `at` before the step after a paragraph break, unless it is
 * there already. An editor may re-render the block the break made and leave
 * the DOM caret elsewhere: Chromium's `insertParagraph` at the end of an
 * `<h1>` makes a `<div>`, which Quill replaces with a `<p>` of its own, the
 * caret left between the blocks (or wherever its re-render put it), and the
 * text typed there landed in the heading or was lost (#61). `at` is where the
 * projection puts the new line's start, read after the editor's re-render.
 * The editor gets a task to take the caret, as after the first selection.
 */
async function placeCaret(host: Element, at: DomPoint | null | undefined, pauses: Pauses): Promise<boolean> {
  if (!at || isSelected(host, at, at)) return true;
  selectDom(host, at, at);
  settleEditor(host);
  return pauses.step();
}

/** Whether the selection inside `host` is still from `from` to `to`, either way round. */
function isSelected(host: Element, from: DomPoint, to: DomPoint): boolean {
  const sel = readDomSelection(host);
  if (!sel) return false;
  const same = (a: DomPoint, b: DomPoint) => a.node === b.node && a.offset === b.offset;
  return (same(sel.anchor, from) && same(sel.focus, to)) || (same(sel.anchor, to) && same(sel.focus, from));
}

/** The `inputType` a step offers the editor (ADR 0008): any deletion is `deleteContentBackward`, never `deleteContent`, which Lexical and Slate cancel and drop. */
const INPUT_TYPE: Record<Step["command"], string> = {
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
function run(host: Element, step: Step): boolean {
  const data = step.command === "insertText" ? step.text : null;
  const ok = offer(host, { inputType: INPUT_TYPE[step.command], data }) ? true : execute(step);
  settleEditor(host);
  return ok;
}

/** The browser's own editing command for `step`; false when it refused it. */
function execute(step: Step): boolean {
  return document.execCommand(step.command, false, step.command === "insertText" ? step.text : undefined);
}

/**
 * Offers an edit to the page's editor as a cancelable synthetic `beforeinput`
 * on the host, its target the selected range. True when a listener cancelled
 * it: the editor has taken the edit over, whatever it then does.
 */
function offer(host: Element, init: Pick<InputEventInit, "inputType" | "data" | "dataTransfer">): boolean {
  const offered = new InputEvent("beforeinput", {
    ...init,
    bubbles: true,
    cancelable: true,
    composed: true,
    targetRanges: selectedRange(host),
  });
  return !host.dispatchEvent(offered);
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
 * Offers an Atom's restore (an undone Atom deletion) to the page's editor at
 * the caret, as each write step is offered (ADR 0008): a cancelable synthetic
 * `beforeinput` of `insertFromPaste` carrying the Atom's markup as
 * `text/html`. Returns true when a listener cancelled it: the editor has taken
 * the restore over, whatever it then does, and gets no `insertHTML`. Lexical
 * cancels it and does nothing (it pastes only from a real `paste` event), and
 * a decorator cannot come back through the DOM there: `insertHTML` turned its
 * whole line into the decorator's text (#62).
 */
export function offerRestore(host: Element, html: string): boolean {
  const dataTransfer = new DataTransfer();
  dataTransfer.setData("text/html", html);
  const taken = offer(host, { inputType: "insertFromPaste", dataTransfer });
  settleEditor(host);
  return taken;
}

/**
 * Inserts an Atom's markup at the caret through the browser's own
 * `insertHTML`, the one editing command that can bring back an element,
 * once the page has let the offered restore through (`offerRestore`).
 * Returns false when the browser refused it.
 */
export function insertAtomHtml(html: string): boolean {
  return document.execCommand("insertHTML", false, html);
}

/**
 * Types the marker that holds an Atom's place while its restore lands
 * (`ContentEditableField.insertAtom`) at the selection: the browser's own
 * `insertText`, never offered as a `beforeinput`. An editor that took an
 * offered `insertText` of it into its model would keep the marker there,
 * whatever became of the DOM; the marker is no text of the Field's.
 */
export function insertMarker(host: Element, marker: string): boolean {
  return runUnoffered(host, { command: "insertText", text: marker });
}

/** Deletes the selected marker (`insertMarker`) as it was typed: the browser's own `delete`, never offered. */
export function deleteMarker(host: Element): boolean {
  return runUnoffered(host, { command: "delete" });
}

function runUnoffered(host: Element, step: Step): boolean {
  const ok = execute(step);
  settleEditor(host);
  return ok;
}
