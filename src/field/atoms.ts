/**
 * Atoms (GLOSSARY.md; DESIGN.md "contenteditable Fields", _Atoms_): what sits
 * in a contenteditable Field like a character but is not text. To Vim each is
 * one U+FFFC; in a register it is its visible text.
 */

/** The character an Atom projects as (OBJECT REPLACEMENT CHARACTER). */
export const ATOM_CHAR = "\uFFFC";

/** Replaced elements: content the page draws, not text the editor holds. */
const REPLACED = new Set([
  "img",
  "picture",
  "video",
  "audio",
  "canvas",
  "iframe",
  "object",
  "embed",
  "svg",
  "input",
  "select",
  "textarea",
  "button",
]);

/**
 * What an element inside an editing host is to the projection.
 *
 * An Atom: a replaced element (non-editable or not), or a non-editable island
 * (`contenteditable="false"`, so its `isContentEditable` is false while the
 * host around it is editable) with text or a replaced element of its own. A
 * nested editable inside an island is part of the island.
 *
 * Decoration: any other non-editable element, with no text and no replaced
 * element inside. It draws only decoration, as Quill's list marker (an empty
 * `ql-ui` span whose `::before` is the bullet, #60) does; it is no text of its
 * line and not an Atom, and the projection leaves it out.
 *
 * Null: neither, an editable element whose content is projected.
 */
export function atomKind(el: Element): "atom" | "decoration" | null {
  if (REPLACED.has(el.localName)) return "atom";
  if (!(el instanceof HTMLElement) || el.isContentEditable) return null;
  if (el.textContent !== "") return "atom";
  for (const name of REPLACED) if (el.querySelector(name)) return "atom";
  return "decoration";
}

/** What a yank stores for an Atom: an image's `alt`, an island's rendered text, nothing for other replaced elements. */
export function atomText(el: Element): string {
  if (el.localName === "img") return el.getAttribute("alt") ?? "";
  if (REPLACED.has(el.localName)) return "";
  return el instanceof HTMLElement ? el.innerText : (el.textContent ?? "");
}
