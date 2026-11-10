import type { Field, TextControl } from "./Field";
import { TextareaField } from "./TextareaField";
import { ContentEditableField } from "./ContentEditableField";

/**
 * An element that is a Field, and how to make its Field. `element` is the
 * Field's own element, which is what a Session is keyed by; it need not be the
 * element asked about (a focus inside a contenteditable host resolves to the
 * host).
 */
export interface ResolvedField {
  readonly element: HTMLElement;
  create(): Field;
}

const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "email", "tel"]);

function isTextControl(el: EventTarget | null): el is TextControl {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(el.type) && !el.readOnly && !el.disabled;
  }
  return false;
}

/**
 * The editing host around a node (DESIGN.md "contenteditable Fields", _Which
 * element_): the outermost element whose `isContentEditable` is true and whose
 * parent's is not. A node inside a non-editable island (`contenteditable="false"`)
 * or a nested editable belongs to the host around it. Null outside any host.
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

/**
 * The one decision of whether an event target is a Field and which kind:
 * every entry point (focus, keydown, the lifecycle observer, the popup's Mode
 * lookup) asks this, so a new Field kind is one more branch here. Null when
 * the target does not qualify, including a Field that stopped qualifying
 * (readonly, disabled, type changed): the lifecycle observer disposes on that.
 */
export function resolveField(target: EventTarget | null): ResolvedField | null {
  if (isTextControl(target)) return { element: target, create: () => new TextareaField(target) };
  const host = editingHost(target);
  if (host) return { element: host, create: () => new ContentEditableField(host) };
  return null;
}
