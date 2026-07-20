// dom/element-tracker.js — decide which fields VimText manages, and keep a
// per-element Vim state object alive for as long as the element exists.

import { createState } from "../engine/state.js";

// Texty <input> types we handle. Deliberately excludes password (never route
// secrets through a yank register) and non-text types (number, date, ...).
const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "email", "tel", ""]);

const states = new WeakMap();

export function isEditable(el) {
  if (!el || el.disabled || el.readOnly) return false;
  if (el.tagName === "TEXTAREA") return true;
  if (el.tagName === "INPUT") {
    const type = (el.getAttribute("type") || "").toLowerCase();
    return TEXT_INPUT_TYPES.has(type);
  }
  return false;
}

export function isSingleLine(el) {
  return el.tagName === "INPUT";
}

// True the first time we see this element (used to pick the initial mode).
export function hasState(el) {
  return states.has(el);
}

export function getState(el) {
  let s = states.get(el);
  if (!s) {
    s = createState();
    states.set(el, s);
  }
  return s;
}

// Elements that belong to VimText's own UI (search bar, indicator) must never
// be treated as editable targets.
export function isOwnUI(el) {
  return !!(el && el.closest && el.closest("#vimtext-search, #vimtext-mode-indicator"));
}
