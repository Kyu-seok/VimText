import type { Field, TextControl } from "./Field";
import { TextareaField } from "./TextareaField";
import { ContentEditableField } from "./ContentEditableField";
import { selectionFor } from "./domSelection";
import { isStatusHost } from "../ui/statusHost";

/**
 * An element that is a Field, and how to make its Field. `element` is the
 * Field's own element, which is what a Session is keyed by; it need not be the
 * element asked about (a focus inside a contenteditable host resolves to the
 * host).
 */
export interface ResolvedField {
  readonly element: HTMLElement;
  /** Whether the Field it makes is a Single-line Field: a Session made for the other kind no longer fits. */
  readonly singleLine: boolean;
  create(): Field;
}

const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "email", "tel"]);

/**
 * Monaco's input textarea, which is not the code (docs/engine-seams.md,
 * "Monaco's input textarea"; #111): `inputarea`, or `ime-text-area` where
 * Monaco takes input through an EditContext.
 */
function isMonacoInput(el: HTMLTextAreaElement): boolean {
  return el.matches(".monaco-editor textarea.inputarea, .monaco-editor textarea.ime-text-area");
}

function isTextControl(el: EventTarget | null): el is TextControl {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled && !isMonacoInput(el);
  if (el instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(el.type) && !el.readOnly && !el.disabled;
  }
  return false;
}

/**
 * The editing host around a node (DESIGN.md "contenteditable Fields", _Which
 * element_): the outermost element whose `isContentEditable` is true and whose
 * parent's is not. A node inside a non-editable island (`contenteditable="false"`)
 * belongs to the host around it; one inside a nested element marked editable
 * is that element's Field (`fieldIn`). Null outside any host.
 */
function editingHost(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Node)) return null;
  let host: HTMLElement | null = null;
  for (
    let n: Element | null = target instanceof Element ? target : target.parentElement;
    n;
    n = n.parentElement
  ) {
    if (n instanceof HTMLElement && n.isContentEditable) host = n;
    else if (host) break;
  }
  return host;
}

/** An element that says it is editable itself, not only by inheritance: `contenteditable` of "true", "" or "plaintext-only". */
function marksEditable(el: Element): el is HTMLElement {
  const v = el.getAttribute("contenteditable");
  return el instanceof HTMLElement && el.isContentEditable && v !== null && v !== "false";
}

/** The Selection that reports positions inside `host`'s tree (see `domSelection.ts`). */
function selectionNodeIn(host: HTMLElement): Node | null {
  const node = selectionFor(host)?.anchorNode ?? null;
  return node && host.contains(node) && node !== host ? node : null;
}

/**
 * The Field inside an editing host (DESIGN.md "contenteditable Fields", _Which
 * element_; #69): the innermost element below it that is marked editable and
 * holds `from`, else the host. A page that marks each block editable inside one
 * editable root (Notion) keeps focus, and so key and focus targets, on the
 * root: there `from` is the root itself and the caret decides.
 */
function fieldIn(host: HTMLElement, from: Node): HTMLElement {
  const start = from === host ? selectionNodeIn(host) : from;
  for (let n: Node | null = start; n && n !== host; n = n.parentNode) {
    if (n instanceof Element && marksEditable(n)) return n as HTMLElement;
  }
  return host;
}

/**
 * A host is a Single-line Field only when it says so (DESIGN.md
 * "contenteditable Fields", _Single-line_): no guessing from height or role.
 */
function declaresSingleLine(host: HTMLElement): boolean {
  return host.getAttribute("aria-multiline") === "false";
}

/**
 * True for a node in VimText's own UI: a Status Line host or anything in its
 * shadow root, the `:` `/` `?` input and the hidden mirror's editor included.
 * The document listeners follow `composedPath()` into that root, where the
 * command line's input is a text control: resolved as a Field, Esc there
 * Activated a second Session instead of closing the command line (#78).
 */
function inVimTextUi(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false;
  for (let n: Node | null = target; n;) {
    if (isStatusHost(n)) return true;
    const root = n.getRootNode();
    n = root instanceof ShadowRoot ? root.host : null;
  }
  return false;
}

/**
 * The one decision of whether an event target is a Field and which kind:
 * every entry point (focus, keydown, the lifecycle observer, the popup's Mode
 * lookup) asks this, so a new Field kind is one more branch here. Null when
 * the target does not qualify, including a Field that stopped qualifying
 * (readonly, disabled, type changed): the lifecycle observer disposes on that.
 */
export function resolveField(target: EventTarget | null): ResolvedField | null {
  if (inVimTextUi(target)) return null;
  if (isTextControl(target)) {
    return {
      element: target,
      singleLine: target instanceof HTMLInputElement,
      create: () => new TextareaField(target),
    };
  }
  const outer = editingHost(target);
  if (outer) {
    const host = fieldIn(outer, target as Node);
    const singleLine = declaresSingleLine(host);
    return { element: host, singleLine, create: () => new ContentEditableField(host, singleLine) };
  }
  return null;
}
