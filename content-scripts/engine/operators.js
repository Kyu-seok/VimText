// engine/operators.js — pure text-editing operators. DOM-free.
//
// Charwise ops take explicit [start, end); linewise ops take two positions and
// act on the whole lines between them. Each returns some of:
//   { text, cursor, register, enterInsert }
// A linewise register value always ends in "\n" so paste can re-insert lines.

import { lineStart, lineEnd, firstNonBlank, clampCursor } from "./motions.js";

// Convert a charwise motion result into a [start, end) range, applying Vim's
// inclusive rule (include the char at `to`, but never the trailing newline).
export function rangeFromMotion(text, from, m) {
  const lo = Math.min(from, m.to);
  let hi = Math.max(from, m.to);
  if (m.inclusive && hi < text.length && text[hi] !== "\n") hi += 1;
  return { start: lo, end: hi };
}

function lineRangeSpan(text, aPos, bPos) {
  const lo = Math.min(aPos, bPos);
  const hi = Math.max(aPos, bPos);
  const start = lineStart(text, lo);
  const contentEnd = lineEnd(text, hi);
  const withNl = contentEnd < text.length ? contentEnd + 1 : contentEnd;
  return { start, contentEnd, withNl };
}

// ---- charwise -------------------------------------------------------------

export function deleteText(text, start, end) {
  const removed = text.slice(start, end);
  const newText = text.slice(0, start) + text.slice(end);
  return {
    text: newText,
    cursor: clampCursor(newText, start),
    register: { text: removed, linewise: false },
  };
}

export function changeText(text, start, end) {
  const removed = text.slice(start, end);
  const newText = text.slice(0, start) + text.slice(end);
  return {
    text: newText,
    cursor: start,
    enterInsert: true,
    register: { text: removed, linewise: false },
  };
}

export function yankText(text, start, end) {
  return {
    register: { text: text.slice(start, end), linewise: false },
    cursor: clampCursor(text, Math.min(start, end)),
  };
}

// x — delete `count` chars under/after the cursor, never crossing the newline.
export function deleteChar(text, pos, count = 1) {
  const le = lineEnd(text, pos);
  const end = Math.min(pos + count, le);
  if (end <= pos) {
    return { text, cursor: clampCursor(text, pos), register: { text: "", linewise: false } };
  }
  const removed = text.slice(pos, end);
  const newText = text.slice(0, pos) + text.slice(end);
  return { text: newText, cursor: clampCursor(newText, pos), register: { text: removed, linewise: false } };
}

// ---- linewise -------------------------------------------------------------

export function deleteLines(text, aPos, bPos) {
  const { start, withNl } = lineRangeSpan(text, aPos, bPos);
  const raw = text.slice(start, withNl);
  const registerText = raw.endsWith("\n") ? raw : raw + "\n";
  let cutStart = start;
  const cutEnd = withNl;
  if (withNl === text.length && start > 0 && text[start - 1] === "\n") cutStart = start - 1;
  const newText = text.slice(0, cutStart) + text.slice(cutEnd);
  const cursor = clampCursor(newText, firstNonBlank(newText, Math.min(cutStart, newText.length)));
  return { text: newText, cursor, register: { text: registerText, linewise: true } };
}

export function changeLines(text, aPos, bPos) {
  const { start, contentEnd } = lineRangeSpan(text, aPos, bPos);
  const registerText = text.slice(start, contentEnd) + "\n";
  const newText = text.slice(0, start) + text.slice(contentEnd);
  return { text: newText, cursor: start, enterInsert: true, register: { text: registerText, linewise: true } };
}

export function yankLines(text, aPos, bPos) {
  const { start, withNl } = lineRangeSpan(text, aPos, bPos);
  const raw = text.slice(start, withNl);
  const registerText = raw.endsWith("\n") ? raw : raw + "\n";
  return { register: { text: registerText, linewise: true }, cursor: clampCursor(text, start) };
}

// ---- paste ----------------------------------------------------------------

export function paste(text, pos, register, before = false) {
  if (!register || !register.text) return { text, cursor: clampCursor(text, pos) };

  if (register.linewise) {
    const insertText = register.text; // ends with "\n"
    if (before) {
      const ls = lineStart(text, pos);
      const newText = text.slice(0, ls) + insertText + text.slice(ls);
      return { text: newText, cursor: clampCursor(newText, firstNonBlank(newText, ls)) };
    }
    const le = lineEnd(text, pos);
    if (le >= text.length) {
      // last line has no trailing newline: add one, drop the register's trailing \n
      const newText = text.slice(0, le) + "\n" + insertText.replace(/\n$/, "");
      return { text: newText, cursor: clampCursor(newText, firstNonBlank(newText, le + 1)) };
    }
    const at = le + 1;
    const newText = text.slice(0, at) + insertText + text.slice(at);
    return { text: newText, cursor: clampCursor(newText, firstNonBlank(newText, at)) };
  }

  // charwise: p pastes after the cursor, P before it
  const at = before ? pos : Math.min(pos + 1, text.length);
  const newText = text.slice(0, at) + register.text + text.slice(at);
  return { text: newText, cursor: clampCursor(newText, at + register.text.length - 1) };
}
