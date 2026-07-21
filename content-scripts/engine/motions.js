// engine/motions.js — pure cursor motions. DOM-free and side-effect-free.
//
// Every motion returns { to, inclusive, linewise }:
//   to        target character offset
//   inclusive whether an operator should include the char at `to` (e, $)
//   linewise  whether an operator should act on whole lines (j, k, gg, G)
// Cursor movement uses `to` (clamped via clampCursor); operators feed the
// result to rangeFromMotion() in operators.js.

// ---- line helpers ---------------------------------------------------------

export function lineStart(text, pos) {
  if (pos <= 0) return 0;
  const nl = text.lastIndexOf("\n", pos - 1);
  return nl === -1 ? 0 : nl + 1;
}

export function lineEnd(text, pos) {
  const nl = text.indexOf("\n", pos);
  return nl === -1 ? text.length : nl;
}

export function firstNonBlank(text, pos) {
  const s = lineStart(text, pos);
  const e = lineEnd(text, pos);
  let i = s;
  while (i < e && (text[i] === " " || text[i] === "\t")) i++;
  return i;
}

export function lineCount(text) {
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") n++;
  return n;
}

// Start offset of the given 1-based line, clamped to the last line.
export function lineStartOfLine(text, line) {
  if (line <= 1) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      count++;
      if (count === line) return i + 1;
    }
  }
  return lineStart(text, text.length);
}

function firstNonBlankOfLine(text, line) {
  return firstNonBlank(text, lineStartOfLine(text, line));
}

// Keep a Normal/Visual cursor on an actual character: never on the trailing
// newline, never past end. Insert mode passes allowEol to sit between chars.
export function clampCursor(text, pos, { allowEol = false } = {}) {
  const n = text.length;
  pos = Math.max(0, Math.min(pos, n));
  if (allowEol) return pos;
  const ls = lineStart(text, pos);
  const le = lineEnd(text, pos);
  if (le === ls) return ls; // empty line
  if (pos >= le) return le - 1; // was on newline/beyond
  return pos;
}

// ---- word helpers ---------------------------------------------------------

export function charClass(ch) {
  if (ch === undefined) return 0;
  if (/\s/.test(ch)) return 0; // whitespace, incl. newline
  if (/[A-Za-z0-9_]/.test(ch)) return 1; // word char
  return 2; // punctuation / other
}

function wordForwardOnce(text, pos) {
  const n = text.length;
  let i = pos;
  if (i >= n) return n;
  const cls = charClass(text[i]);
  if (cls !== 0) while (i < n && charClass(text[i]) === cls) i++;
  while (i < n && charClass(text[i]) === 0) i++;
  return Math.min(i, n);
}

function wordEndOnce(text, pos) {
  const n = text.length;
  let i = pos + 1;
  while (i < n && charClass(text[i]) === 0) i++;
  if (i >= n) return Math.max(pos, n - 1);
  const cls = charClass(text[i]);
  while (i + 1 < n && charClass(text[i + 1]) === cls) i++;
  return i;
}

function wordBackOnce(text, pos) {
  let i = pos - 1;
  while (i > 0 && charClass(text[i]) === 0) i--;
  if (i <= 0) return 0;
  const cls = charClass(text[i]);
  while (i - 1 >= 0 && charClass(text[i - 1]) === cls) i--;
  return i;
}

function verticalMove(text, pos, count, dir) {
  const col = pos - lineStart(text, pos);
  let ls = lineStart(text, pos);
  let le = lineEnd(text, pos);
  let steps = count;
  if (dir > 0) {
    while (steps-- > 0) {
      if (le >= text.length) break;
      ls = le + 1;
      le = lineEnd(text, ls);
    }
  } else {
    while (steps-- > 0) {
      if (ls <= 0) break;
      le = ls - 1;
      ls = lineStart(text, le);
    }
  }
  return ls + Math.min(col, le - ls);
}

// ---- main dispatcher ------------------------------------------------------

// `count` is the raw numeric count or null when the user typed none — the
// distinction matters for gg (line 1 vs line N) and G (last line vs line N).
export function computeMotion(name, text, pos, count = null, opts = {}) {
  const n = text.length;
  pos = Math.max(0, Math.min(pos, n));
  const c = Math.max(1, count || 1);

  switch (name) {
    case "h":
      return { to: Math.max(lineStart(text, pos), pos - c), inclusive: false, linewise: false };
    case "l":
      return { to: Math.min(lineEnd(text, pos), pos + c), inclusive: false, linewise: false };
    case "0":
      return { to: lineStart(text, pos), inclusive: false, linewise: false };
    case "^":
      return { to: firstNonBlank(text, pos), inclusive: false, linewise: false };
    case "$": {
      let le = lineEnd(text, pos);
      let steps = c - 1;
      while (steps-- > 0 && le < n) le = lineEnd(text, le + 1);
      const ls = lineStart(text, le);
      return { to: le > ls ? le - 1 : ls, inclusive: true, linewise: false };
    }
    case "w": {
      let to = pos;
      for (let i = 0; i < c; i++) to = wordForwardOnce(text, to);
      return { to, inclusive: false, linewise: false };
    }
    case "b": {
      let to = pos;
      for (let i = 0; i < c; i++) to = wordBackOnce(text, to);
      return { to, inclusive: false, linewise: false };
    }
    case "e": {
      let to = pos;
      for (let i = 0; i < c; i++) to = wordEndOnce(text, to);
      return { to, inclusive: true, linewise: false };
    }
    case "j":
      if (opts.singleLine) return { to: pos, inclusive: false, linewise: true };
      return { to: verticalMove(text, pos, c, +1), inclusive: false, linewise: true };
    case "k":
      if (opts.singleLine) return { to: pos, inclusive: false, linewise: true };
      return { to: verticalMove(text, pos, c, -1), inclusive: false, linewise: true };
    case "gg": {
      const line = count && count > 0 ? count : 1;
      return { to: firstNonBlankOfLine(text, line), inclusive: false, linewise: true };
    }
    case "G": {
      const line = count && count > 0 ? count : lineCount(text);
      return { to: firstNonBlankOfLine(text, line), inclusive: false, linewise: true };
    }
    default:
      return null;
  }
}

// Which single-key names are motions (used by the keymap).
export const MOTION_KEYS = new Set(["h", "l", "j", "k", "0", "^", "$", "w", "b", "e"]);
