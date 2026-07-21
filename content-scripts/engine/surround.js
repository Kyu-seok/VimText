// engine/surround.js — vim-surround operations. Pure, DOM-free.
//
// Add / change / delete surrounding delimiters. Delimiter characters follow
// surround's spacing rule: an OPENING bracket ( [ { adds inner spaces, a
// CLOSING bracket ) ] } does not. Quotes " ' ` surround with themselves.
//
// Source delimiters (for cs/ds) may be any text-object char including "t"
// (tag), resolved via textObject(). Destination delimiters (dst of cs, and ys)
// are brackets/quotes only — adding a *tag* needs a name prompt and is handled
// (deferred) at the UI layer, not here.

import { textObject } from "./textobjects.js";

const PAIR = {
  "(": ["( ", " )"], ")": ["(", ")"], b: ["(", ")"],
  "[": ["[ ", " ]"], "]": ["[", "]"], r: ["[", "]"],
  "{": ["{ ", " }"], "}": ["{", "}"], B: ["{", "}"],
};
const QUOTES = new Set(['"', "'", "`"]);
const OPEN_BRACKETS = new Set(["(", "[", "{"]);

// Resolve a destination char to [open, close] strings, or null if unsupported.
export function delimiters(ch) {
  if (PAIR[ch]) return PAIR[ch];
  if (QUOTES.has(ch)) return [ch, ch];
  return null;
}

// Wrap [start, end) with the delimiters for `ch`.
export function addSurround(text, start, end, ch) {
  const d = delimiters(ch);
  if (!d) return null;
  const newText = text.slice(0, start) + d[0] + text.slice(start, end) + d[1] + text.slice(end);
  return { text: newText, cursor: start };
}

// The tight delimiter bounds around `pos`. For single-char delimiters the
// delimiters sit immediately outside the inner range — we must NOT use the "a"
// text object, which for quotes/words also eats adjacent whitespace. Tags have
// variable-length delimiters, so fall back to the "at" object there.
function aroundFor(text, pos, ch, inner, opts) {
  if (ch === "t") return textObject(text, pos, "a", ch, opts);
  return { start: inner.start - 1, end: inner.end + 1 };
}

// Change the surround `srcCh` around the cursor into `dstCh`.
export function changeSurround(text, pos, srcCh, dstCh, opts = {}) {
  const d = delimiters(dstCh);
  const inner = textObject(text, pos, "i", srcCh, opts);
  if (!d || !inner) return null;
  const a = aroundFor(text, pos, srcCh, inner, opts);
  if (!a) return null;
  const mid = text.slice(inner.start, inner.end);
  const newText = text.slice(0, a.start) + d[0] + mid + d[1] + text.slice(a.end);
  return { text: newText, cursor: a.start };
}

// Delete the surround `ch` around the cursor.
export function deleteSurround(text, pos, ch, opts = {}) {
  const inner = textObject(text, pos, "i", ch, opts);
  if (!inner) return null;
  const a = aroundFor(text, pos, ch, inner, opts);
  if (!a) return null;
  let mid = text.slice(inner.start, inner.end);
  if (OPEN_BRACKETS.has(ch)) mid = mid.replace(/^ /, "").replace(/ $/, ""); // ds( strips a space pair
  const newText = text.slice(0, a.start) + mid + text.slice(a.end);
  return { text: newText, cursor: a.start };
}
