/**
 * Builders and observers for contenteditable Fields in the unit suite, shared
 * by every contenteditable test file (the tracer bullet #44 and the tickets
 * that extend it: innerText parity, ProseMirror, Atoms, refused edits,
 * `aria-multiline`, shadow roots). A test builds a host from markup, drives it
 * through the `Field` interface or a Session, and observes what the page sees:
 * the host's blocks, its `innerText`, the events the editor would get.
 */
import { ContentEditableField } from "../../src/field/ContentEditableField";
import { Session } from "../../src/bridge/Session";

/** Fixed metrics so the mirror's wrapping and the Field's line count are stable across machines. */
const HOST_STYLE = "width:480px;min-height:60px;font:14px/20px monospace;padding:4px;outline:none";

/**
 * A contenteditable host built from `html`, appended to `parent` (the body by
 * default; a shadow root for the shadow-root ticket). Markup without
 * whitespace between tags: whitespace handling is its own rule set.
 */
export function editableHost(
  html: string,
  opts: { contenteditable?: string; attrs?: Record<string, string>; parent?: Node } = {},
): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute("contenteditable", opts.contenteditable ?? "true");
  for (const [k, v] of Object.entries(opts.attrs ?? {})) host.setAttribute(k, v);
  host.style.cssText = HOST_STYLE;
  host.innerHTML = html;
  (opts.parent ?? document.body).appendChild(host);
  return host;
}

/** The text of each direct child block, a no-break space read as the space it renders as (Chrome writes one where a space would collapse). */
export function blockTexts(host: HTMLElement): string[] {
  return [...host.children].map((c) => (c.textContent ?? "").replace(/\u00a0/g, " "));
}

/** The `inputType` of every `beforeinput` and `input` the host fires, as `before:…` / `input:…`. */
export function inputLog(host: HTMLElement): string[] {
  const log: string[] = [];
  host.addEventListener("beforeinput", (e) => log.push(`before:${(e as InputEvent).inputType}`));
  host.addEventListener("input", (e) => log.push(`input:${(e as InputEvent).inputType}`));
  return log;
}

/** Places a collapsed caret at `offset` in `node` (a text node or an element), as a click would. */
export function caretAt(node: Node, offset = 0): void {
  getSelection()!.setBaseAndExtent(node, offset, node, offset);
}

/** The text the native selection covers: a Normal-mode cursor's character, a Visual selection. */
export function selectedText(): string {
  return getSelection()!.toString();
}

/**
 * Native Insert-mode typing as the browser does it: the editor's own edit at
 * the caret, which fires `input` on the host (not a VimText write).
 */
export function typeNatively(text: string): void {
  document.execCommand("insertText", false, text);
}

/** A Session on a contenteditable host built from `html`, focused with the caret at its start. */
export function activeHost(html: string, opts: Parameters<typeof editableHost>[1] = {}) {
  const host = editableHost(html, opts);
  host.focus();
  caretAt(host, 0);
  const field = new ContentEditableField(host);
  const session = new Session(field, { vimrc: "" });
  return {
    host,
    field,
    session,
    destroy() {
      session.destroy();
      field.destroy();
      host.remove();
    },
  };
}
