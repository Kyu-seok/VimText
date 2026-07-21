// engine/keymap.js — translate a normalized key into an engine command.
//
// handleKey(state, doc, key, opts) mutates `state` (mode, pending count/op,
// register, undo stacks, visual anchor, last search, text-object/surround
// sub-states) and returns { handled, text, cursor, effect }.
//
// `key` is a plain object { key, ctrl, shift, alt, meta } so the engine is
// testable without real KeyboardEvents. `opts.singleLine` is true for <input>;
// `opts.plugins` = { surround, targets } gates the plugin features.

import { Mode, isVisual, clearPending, pushUndo, undo, redo } from "./state.js";
import { computeMotion, MOTION_KEYS, lineStart, lineEnd, firstNonBlank, clampCursor } from "./motions.js";
import {
  rangeFromMotion, deleteText, changeText, yankText, deleteChar,
  deleteLines, changeLines, yankLines, paste,
} from "./operators.js";
import { textObject, TEXT_OBJECT_CHARS } from "./textobjects.js";
import { addSurround, changeSurround, deleteSurround } from "./surround.js";

export function handleKey(state, doc, key, opts = {}) {
  const ctx = { singleLine: !!opts.singleLine, plugins: opts.plugins || {} };
  const text = doc.text;
  const cursor = doc.cursor;
  const k = key.key;
  const ctrl = !!key.ctrl;
  const mode = state.mode;

  const isEsc = k === "Escape" || (ctrl && k === "[");
  const clampN = (to) => clampCursor(text, to);
  const keep = () => ({ handled: true, text, cursor });
  const commit = (t, c, effect = null) => { clearPending(state); return { handled: true, text: t, cursor: c, effect }; };

  // ---------------- INSERT ----------------
  if (mode === Mode.INSERT) {
    if (isEsc) {
      state.mode = Mode.NORMAL;
      clearPending(state);
      return { handled: true, text, cursor: clampCursor(text, Math.max(lineStart(text, cursor), cursor - 1)), effect: { type: "insert-exit" } };
    }
    return { handled: false, text, cursor };
  }

  // ---------------- Esc / Ctrl+[ in NORMAL/VISUAL ----------------
  if (isEsc) {
    const wasVisual = isVisual(mode);
    state.mode = Mode.NORMAL;
    state.visualAnchor = null;
    clearPending(state);
    return { handled: true, text, cursor: clampN(cursor), effect: wasVisual ? { type: "visual-exit" } : null };
  }

  // ---------------- counts ----------------
  const isDigit = k.length === 1 && k >= "0" && k <= "9";
  if (isDigit && !(k === "0" && state.count === "")) {
    state.count += k;
    return keep();
  }
  const count = state.count ? parseInt(state.count, 10) : null;

  // ---------------- g prefix (gg) ----------------
  let motionName = null;
  if (state.awaitingG) {
    state.awaitingG = false;
    if (k === "g") motionName = "gg";
    else return commit(text, clampN(cursor));
  } else if (k === "g") {
    state.awaitingG = true;
    return keep();
  }
  if (!motionName) {
    if (k === "$" || k === "^" || k === "0" || k === "G") motionName = k;
    else if (MOTION_KEYS.has(k)) motionName = k;
  }

  // ---------------- active sub-states (continuation of a multi-key command) ----------------
  // Text object first: `ysiw)` sets pendingTextObj *while* pendingSurround is
  // still active, and the object must win over the surround motion parser.
  if (state.pendingTextObj) return handleTextObject(state, text, cursor, k, count, ctx);
  if (state.pendingSurround) return handleSurround(state, text, cursor, k, motionName, count, ctx);

  // ---------------- VISUAL / VISUAL LINE ----------------
  if (isVisual(mode)) {
    if (k === "i" || k === "a") { state.pendingTextObj = { kind: k, which: "current" }; return keep(); }
    if (ctx.plugins.surround && k === "S") { state.pendingSurround = { cmd: "S" }; return keep(); }
    if (k === "d" || k === "x" || k === "y" || k === "c") {
      return visualApply(state, text, cursor, k === "x" ? "d" : k);
    }
    if (k === "v") {
      if (mode === Mode.VISUAL) { state.mode = Mode.NORMAL; state.visualAnchor = null; return commit(text, clampN(cursor)); }
      state.mode = Mode.VISUAL; return keep();
    }
    if (k === "V") {
      if (mode === Mode.VISUAL_LINE) { state.mode = Mode.NORMAL; state.visualAnchor = null; return commit(text, clampN(cursor)); }
      state.mode = Mode.VISUAL_LINE; return keep();
    }
    if (motionName) {
      const m = computeMotion(motionName, text, cursor, count, { singleLine: ctx.singleLine });
      clearPending(state);
      return { handled: true, text, cursor: clampN(m.to) };
    }
    return keep();
  }

  // ---------------- NORMAL: pending operator ----------------
  if (state.operator) {
    const op = state.operator;
    if (ctx.plugins.surround && k === "s") { enterSurroundFromOperator(state, op); return keep(); }
    if (k === "i" || k === "a") { state.pendingTextObj = { kind: k, which: "current" }; return keep(); }
    if (k === op) return applyLinewiseDoubled(state, text, cursor, op, count);
    if (motionName) return applyOperatorMotion(state, text, cursor, op, motionName, count, ctx.singleLine);
    return commit(text, clampN(cursor));
  }

  // ---------------- NORMAL: bare motion ----------------
  if (motionName) {
    const m = computeMotion(motionName, text, cursor, count, { singleLine: ctx.singleLine });
    return commit(text, clampN(m.to));
  }

  // ---------------- NORMAL: commands ----------------
  switch (k) {
    case "d": case "c": case "y":
      state.operator = k; return keep();

    case "x": {
      pushUndo(state, { text, cursor });
      const out = deleteChar(text, cursor, count || 1);
      state.register = out.register;
      return commit(out.text, out.cursor);
    }

    case "i": case "a": case "I": case "A": case "o": case "O": {
      const variant = ctx.singleLine && (k === "o" || k === "O") ? "a" : k;
      const out = enterInsert(state, text, cursor, variant);
      return { handled: true, text: out.text, cursor: out.cursor, effect: { type: "insert-enter" } };
    }

    case "v": clearPending(state); state.mode = Mode.VISUAL; state.visualAnchor = cursor; return { handled: true, text, cursor: clampN(cursor) };
    case "V": clearPending(state); state.mode = Mode.VISUAL_LINE; state.visualAnchor = cursor; return { handled: true, text, cursor: clampN(cursor) };

    case "p": case "P": {
      pushUndo(state, { text, cursor });
      let t = text, c = cursor;
      const times = count || 1;
      for (let i = 0; i < times; i++) { const out = paste(t, c, state.register, k === "P"); t = out.text; c = out.cursor; }
      return commit(t, c);
    }

    case "u": {
      const prev = undo(state, { text, cursor });
      clearPending(state);
      if (!prev) return { handled: true, text, cursor: clampN(cursor) };
      return { handled: true, text: prev.text, cursor: clampCursor(prev.text, prev.cursor) };
    }

    case "r": {
      if (!ctrl) return commit(text, clampN(cursor)); // bare r (replace) deferred
      const next = redo(state, { text, cursor });
      clearPending(state);
      if (!next) return { handled: true, text, cursor: clampN(cursor) };
      return { handled: true, text: next.text, cursor: clampCursor(next.text, next.cursor) };
    }

    case "/":
      return commit(text, clampN(cursor), { type: "search-open" });

    case "n": case "N": {
      const { pattern, forward } = state.lastSearch;
      clearPending(state);
      if (!pattern) return { handled: true, text, cursor: clampN(cursor) };
      const dir = k === "n" ? forward : !forward;
      const idx = searchNext(text, cursor, pattern, dir);
      return { handled: true, text, cursor: idx == null ? clampN(cursor) : clampN(idx) };
    }

    case "Tab":
      clearPending(state);
      return { handled: false, text, cursor };

    default:
      return commit(text, clampN(cursor)); // swallow unmapped keys
  }
}

// ---- text objects ---------------------------------------------------------

function handleTextObject(state, text, cursor, k, count, ctx) {
  const to = state.pendingTextObj;
  // targets.vim next/last modifiers
  if (ctx.plugins.targets && (k === "n" || k === "l") && to.which === "current") {
    to.which = k === "n" ? "next" : "last";
    return { handled: true, text, cursor };
  }
  if (!TEXT_OBJECT_CHARS.has(k)) {
    if (to.forSurround) state.pendingSurround = null;
    clearPending(state);
    return { handled: true, text, cursor: clampCursor(text, cursor) };
  }
  const range = textObject(text, cursor, to.kind, k, {
    seek: !!ctx.plugins.targets, which: to.which, count,
  });
  const forSurround = to.forSurround;
  const op = state.operator;
  state.pendingTextObj = null;

  if (!range) {
    if (forSurround) state.pendingSurround = null;
    clearPending(state);
    return { handled: true, text, cursor: clampCursor(text, cursor) };
  }
  if (forSurround) {
    state.pendingSurround.range = range;
    state.pendingSurround.stage = "delim";
    return { handled: true, text, cursor };
  }
  if (isVisual(state.mode)) {
    state.visualAnchor = range.start;
    clearPending(state);
    return { handled: true, text, cursor: clampCursor(text, Math.max(range.start, range.end - 1)) };
  }
  return applyOperatorRange(state, text, cursor, op, range);
}

function applyOperatorRange(state, text, cursor, op, range) {
  let out;
  if (op === "y") out = yankText(text, range.start, range.end);
  else if (op === "c") { pushUndo(state, { text, cursor }); out = changeText(text, range.start, range.end); }
  else { pushUndo(state, { text, cursor }); out = deleteText(text, range.start, range.end); }
  return finishOp(state, out, text);
}

// ---- vim-surround ---------------------------------------------------------

function enterSurroundFromOperator(state, op) {
  if (op === "y") state.pendingSurround = { cmd: "ys", stage: "motion", range: null };
  else if (op === "d") state.pendingSurround = { cmd: "ds" };
  else if (op === "c") state.pendingSurround = { cmd: "cs", src: null };
  state.operator = null;
}

function handleSurround(state, text, cursor, k, motionName, count, ctx) {
  const s = state.pendingSurround;
  const cancel = () => { clearPending(state); return { handled: true, text, cursor: clampCursor(text, cursor) }; };

  if (s.cmd === "ds") return finishSurroundEdit(state, text, cursor, () => deleteSurround(text, cursor, k, { seek: !!ctx.plugins.targets }));

  if (s.cmd === "cs") {
    if (!s.src) { s.src = k; return { handled: true, text, cursor }; }
    return finishSurroundEdit(state, text, cursor, () => changeSurround(text, cursor, s.src, k, { seek: !!ctx.plugins.targets }));
  }

  if (s.cmd === "S") {
    const anchor = state.visualAnchor == null ? cursor : state.visualAnchor;
    const start = Math.min(anchor, cursor);
    const end = Math.min(Math.max(anchor, cursor) + 1, text.length);
    state.visualAnchor = null;
    state.mode = Mode.NORMAL;
    return finishSurroundEdit(state, text, cursor, () => addSurround(text, start, end, k), { type: "visual-exit" });
  }

  // cmd === "ys"
  if (s.stage === "delim") return finishSurroundEdit(state, text, s.range.start, () => addSurround(text, s.range.start, s.range.end, k));
  // motion stage: resolve the target range
  if (k === "s") { // yss — whole line (first non-blank .. end)
    s.range = { start: firstNonBlank(text, cursor), end: lineEnd(text, cursor) };
    s.stage = "delim";
    return { handled: true, text, cursor };
  }
  if (k === "i" || k === "a") {
    state.pendingTextObj = { kind: k, which: "current", forSurround: true };
    return { handled: true, text, cursor };
  }
  if (motionName) {
    const m = computeMotion(motionName, text, cursor, count, { singleLine: ctx.singleLine });
    if (m) {
      s.range = m.linewise
        ? { start: lineStart(text, Math.min(cursor, m.to)), end: lineEnd(text, Math.max(cursor, m.to)) }
        : rangeFromMotion(text, cursor, m);
      s.stage = "delim";
      return { handled: true, text, cursor };
    }
  }
  return cancel();
}

// Run a surround op that returns { text, cursor } | null, snapshotting undo.
function finishSurroundEdit(state, text, cursorForSnapshot, run, effect = null) {
  const out = run();
  clearPending(state);
  if (!out) return { handled: true, text, cursor: clampCursor(text, cursorForSnapshot), effect };
  pushUndo(state, { text, cursor: cursorForSnapshot });
  return { handled: true, text: out.text, cursor: clampCursor(out.text, out.cursor), effect };
}

// ---- shared command helpers ----------------------------------------------

function enterInsert(state, text, cursor, variant) {
  pushUndo(state, { text, cursor });
  let newText = text, newCursor = cursor;
  const ls = lineStart(text, cursor), le = lineEnd(text, cursor);
  switch (variant) {
    case "i": newCursor = cursor; break;
    case "a": newCursor = Math.min(cursor + 1, le); break;
    case "I": newCursor = firstNonBlank(text, cursor); break;
    case "A": newCursor = le; break;
    case "o": newText = text.slice(0, le) + "\n" + text.slice(le); newCursor = le + 1; break;
    case "O": newText = text.slice(0, ls) + "\n" + text.slice(ls); newCursor = ls; break;
  }
  state.mode = Mode.INSERT;
  clearPending(state);
  return { text: newText, cursor: newCursor };
}

function nthLineDown(text, pos, n) {
  let le = lineEnd(text, pos);
  while (n-- > 0 && le < text.length) le = lineEnd(text, le + 1);
  return le;
}

function applyLinewiseDoubled(state, text, cursor, op, count) {
  const bPos = nthLineDown(text, cursor, (count || 1) - 1);
  let out;
  if (op === "d") { pushUndo(state, { text, cursor }); out = deleteLines(text, cursor, bPos); }
  else if (op === "y") { out = yankLines(text, cursor, bPos); }
  else { pushUndo(state, { text, cursor }); out = changeLines(text, cursor, bPos); }
  return finishOp(state, out, text);
}

function applyOperatorMotion(state, text, cursor, op, name, count, singleLine) {
  const effName = op === "c" && name === "w" ? "e" : name; // cw acts like ce
  const m = computeMotion(effName, text, cursor, count, { singleLine });
  if (!m) { clearPending(state); return { handled: true, text, cursor: clampCursor(text, cursor) }; }
  let out;
  if (m.linewise) {
    if (op === "d") { pushUndo(state, { text, cursor }); out = deleteLines(text, cursor, m.to); }
    else if (op === "y") { out = yankLines(text, cursor, m.to); }
    else { pushUndo(state, { text, cursor }); out = changeLines(text, cursor, m.to); }
  } else {
    const r = rangeFromMotion(text, cursor, m);
    if (op === "d") { pushUndo(state, { text, cursor }); out = deleteText(text, r.start, r.end); }
    else if (op === "y") { out = yankText(text, r.start, r.end); }
    else { pushUndo(state, { text, cursor }); out = changeText(text, r.start, r.end); }
  }
  return finishOp(state, out, text);
}

function visualApply(state, text, cursor, op) {
  const anchor = state.visualAnchor == null ? cursor : state.visualAnchor;
  if (op !== "y") pushUndo(state, { text, cursor });
  let out;
  if (state.mode === Mode.VISUAL_LINE) {
    if (op === "d") out = deleteLines(text, anchor, cursor);
    else if (op === "y") out = yankLines(text, anchor, cursor);
    else out = changeLines(text, anchor, cursor);
  } else {
    const start = Math.min(anchor, cursor);
    const end = Math.min(Math.max(anchor, cursor) + 1, text.length);
    if (op === "d") out = deleteText(text, start, end);
    else if (op === "y") out = yankText(text, start, end);
    else out = changeText(text, start, end);
  }
  state.visualAnchor = null;
  const res = finishOp(state, out, text);
  if (!out.enterInsert) res.effect = { type: "visual-exit" };
  return res;
}

function finishOp(state, out, originalText) {
  if (out.register) state.register = out.register;
  clearPending(state);
  const newText = out.text != null ? out.text : originalText;
  if (out.enterInsert) {
    state.mode = Mode.INSERT;
    return { handled: true, text: newText, cursor: out.cursor, effect: { type: "insert-enter" } };
  }
  state.mode = Mode.NORMAL;
  return { handled: true, text: newText, cursor: out.cursor };
}

// ---- search ---------------------------------------------------------------

export function searchNext(text, from, pattern, forward = true) {
  if (!pattern) return null;
  const smart = pattern === pattern.toLowerCase();
  const hay = smart ? text.toLowerCase() : text;
  const needle = smart ? pattern.toLowerCase() : pattern;
  if (forward) {
    let idx = hay.indexOf(needle, from + 1);
    if (idx === -1) idx = hay.indexOf(needle, 0);
    return idx === -1 ? null : idx;
  }
  let idx = hay.lastIndexOf(needle, from - 1);
  if (idx === -1) idx = hay.lastIndexOf(needle);
  return idx === -1 ? null : idx;
}

export function performSearch(state, doc, pattern, forward = true) {
  state.lastSearch = { pattern, forward };
  const idx = searchNext(doc.text, doc.cursor, pattern, forward);
  return { cursor: clampCursor(doc.text, idx == null ? doc.cursor : idx), found: idx != null };
}
