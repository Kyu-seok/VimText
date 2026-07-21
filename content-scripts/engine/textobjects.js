// engine/textobjects.js — Vim text objects. Pure, DOM-free.
//
// textObject(text, pos, kind, obj, opts) -> { start, end } | null   (charwise [start,end))
//   kind : "i" inner | "a" around
//   obj  : "w" word | brackets ( ) b { } B [ ] < > | quotes " ' ` | "t" tag
//   opts : { seek, which: "current"|"next"|"last", count }  (targets.vim extensions)
//
// Base Vim needs the cursor inside a pair; quotes already look forward on the
// line. The targets.vim plugin passes seek/which/count to extend that.

import { lineStart, lineEnd, charClass } from "./motions.js";

export const TEXT_OBJECT_CHARS = new Set([
  "w", "(", ")", "b", "{", "}", "B", "[", "]", "r", "<", ">", '"', "'", "`", "t",
]);

const PAIRS = {
  "(": ["(", ")"], ")": ["(", ")"], b: ["(", ")"],
  "{": ["{", "}"], "}": ["{", "}"], B: ["{", "}"],
  "[": ["[", "]"], "]": ["[", "]"], r: ["[", "]"],
  "<": ["<", ">"], ">": ["<", ">"],
};

export function textObject(text, pos, kind, obj, opts = {}) {
  const around = kind === "a";
  if (obj === "w") return wordObject(text, pos, around);
  if (obj === "t") return tagObject(text, pos, around);
  if (obj === '"' || obj === "'" || obj === "`") return quoteObject(text, pos, obj, around, opts);
  if (PAIRS[obj]) return pairObject(text, pos, PAIRS[obj][0], PAIRS[obj][1], around, opts);
  return null;
}

// ---- word -----------------------------------------------------------------

function wordObject(text, pos, around) {
  const ls = lineStart(text, pos);
  const le = lineEnd(text, pos);
  if (le === ls) return { start: ls, end: ls }; // empty line
  let p = Math.min(pos, le - 1);
  const cls = charClass(text[p]);
  let s = p, e = p;
  while (s > ls && charClass(text[s - 1]) === cls) s--;
  while (e + 1 < le && charClass(text[e + 1]) === cls) e++;
  let start = s, end = e + 1;
  if (around) {
    let te = end;
    while (te < le && charClass(text[te]) === 0) te++;
    if (te > end) end = te; // trailing whitespace
    else while (start > ls && charClass(text[start - 1]) === 0) start--; // else leading
  }
  return { start, end };
}

// ---- brackets -------------------------------------------------------------

function findEnclosingOpen(text, pos, open, close) {
  let depth = 0;
  for (let i = pos; i >= 0; i--) {
    if (i !== pos && text[i] === close) depth++;
    else if (text[i] === open) {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

function findMatchingClose(text, openIdx, open, close) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return i;
  }
  return -1;
}

function findMatchingOpen(text, closeIdx, open, close) {
  let depth = 0;
  for (let i = closeIdx; i >= 0; i--) {
    if (text[i] === close) depth++;
    else if (text[i] === open && --depth === 0) return i;
  }
  return -1;
}

const mkRange = (oi, ci, around) => (around ? { start: oi, end: ci + 1 } : { start: oi + 1, end: ci });

function pairObject(text, pos, open, close, around, opts) {
  const which = opts.which || "current";
  const count = Math.max(1, opts.count || 1);

  if (which === "next") return seekNextPair(text, pos, open, close, around, count);
  if (which === "last") return seekLastPair(text, pos, open, close, around, count);

  const openIdx = findEnclosingOpen(text, pos, open, close);
  const closeIdx = openIdx >= 0 ? findMatchingClose(text, openIdx, open, close) : -1;
  if (openIdx >= 0 && closeIdx >= 0) return mkRange(openIdx, closeIdx, around);
  // not inside a pair — seek forward if allowed (targets.vim)
  return opts.seek ? seekNextPair(text, pos, open, close, around, 1) : null;
}

function seekNextPair(text, pos, open, close, around, count) {
  let from = pos + 1, found = null;
  for (let k = 0; k < count; k++) {
    const oi = text.indexOf(open, from);
    if (oi < 0) return null;
    const ci = findMatchingClose(text, oi, open, close);
    if (ci < 0) return null;
    found = [oi, ci];
    from = oi + 1;
  }
  return found ? mkRange(found[0], found[1], around) : null;
}

function seekLastPair(text, pos, open, close, around, count) {
  let from = pos - 1, found = null;
  for (let k = 0; k < count; k++) {
    const ci = text.lastIndexOf(close, from);
    if (ci < 0) return null;
    const oi = findMatchingOpen(text, ci, open, close);
    if (oi < 0) return null;
    found = [oi, ci];
    from = oi - 1;
  }
  return found ? mkRange(found[0], found[1], around) : null;
}

// ---- quotes ---------------------------------------------------------------

function quoteObject(text, pos, q, around, opts) {
  const ls = lineStart(text, pos), le = lineEnd(text, pos);
  const quotes = [];
  for (let i = ls; i < le; i++) if (text[i] === q) quotes.push(i);
  const pairs = [];
  for (let j = 0; j + 1 < quotes.length; j += 2) pairs.push([quotes[j], quotes[j + 1]]);
  if (pairs.length === 0) return null;

  const which = opts.which || "current";
  let idx;
  if (which === "next") {
    idx = pairs.findIndex(([a]) => a > pos);
    const c = Math.max(1, opts.count || 1);
    if (idx >= 0) idx += c - 1;
  } else if (which === "last") {
    const before = pairs.filter(([, b]) => b < pos);
    idx = before.length - (Math.max(1, opts.count || 1));
  } else {
    // base Vim: first pair whose closing quote is at/after the cursor
    idx = pairs.findIndex(([, b]) => b >= pos);
  }
  if (idx < 0 || idx >= pairs.length) return null;
  const [a, b] = pairs[idx];
  if (!around) return { start: a + 1, end: b };
  let end = b + 1;
  while (end < le && (text[end] === " " || text[end] === "\t")) end++;
  if (end > b + 1) return { start: a, end };
  let start = a;
  while (start > ls && (text[start - 1] === " " || text[start - 1] === "\t")) start--;
  return { start, end: b + 1 };
}

// ---- tags -----------------------------------------------------------------

function tagObject(text, pos, around) {
  const re = /<(\/)?([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g;
  const tags = [];
  let m;
  while ((m = re.exec(text))) {
    tags.push({ start: m.index, end: re.lastIndex, name: m[2].toLowerCase(), close: !!m[1], self: m[3] === "/" });
  }
  const stack = [];
  let best = null;
  for (const t of tags) {
    if (t.self) continue;
    if (!t.close) { stack.push(t); continue; }
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].name === t.name) {
        const open = stack[i];
        stack.length = i;
        if (pos >= open.start && pos < t.end) {
          const r = around
            ? { start: open.start, end: t.end }
            : { start: open.end, end: t.start };
          if (!best || r.end - r.start < best.end - best.start) best = r;
        }
        break;
      }
    }
  }
  return best;
}
