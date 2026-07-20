// engine/state.js — modes and per-element Vim state. Pure, DOM-free.

export const Mode = Object.freeze({
  NORMAL: "NORMAL",
  INSERT: "INSERT",
  VISUAL: "VISUAL",
  VISUAL_LINE: "VISUAL_LINE",
});

export function isVisual(mode) {
  return mode === Mode.VISUAL || mode === Mode.VISUAL_LINE;
}

const UNDO_LIMIT = 200;

// A `doc` throughout the engine is the minimal editing model: { text, cursor }.
// State below is everything *else* the engine needs to remember per element.
export function createState() {
  return {
    mode: Mode.NORMAL,
    // pending input while composing a command
    count: "", // digits accumulated as a string, "" == none
    operator: null, // "d" | "c" | "y" while waiting for a motion
    awaitingG: false, // saw a lone "g", waiting for the second (gg)
    // visual selection anchor (the fixed end); cursor is the moving end
    visualAnchor: null,
    // yank/delete register
    register: { text: "", linewise: false },
    // custom undo/redo — snapshots of { text, cursor }
    undoStack: [],
    redoStack: [],
    // last search, for n / N
    lastSearch: { pattern: "", forward: true },
  };
}

// Clear any half-entered command (counts / pending operator / g-prefix).
export function clearPending(state) {
  state.count = "";
  state.operator = null;
  state.awaitingG = false;
}

// Snapshot the pre-change doc so `u` can restore it. Any new change invalidates
// the redo history, exactly like Vim.
export function pushUndo(state, doc) {
  state.undoStack.push({ text: doc.text, cursor: doc.cursor });
  if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
  state.redoStack.length = 0;
}

// Returns the doc to restore, or null if nothing to undo. Pushes the current
// doc onto the redo stack.
export function undo(state, currentDoc) {
  if (state.undoStack.length === 0) return null;
  const prev = state.undoStack.pop();
  state.redoStack.push({ text: currentDoc.text, cursor: currentDoc.cursor });
  return prev;
}

// Inverse of undo.
export function redo(state, currentDoc) {
  if (state.redoStack.length === 0) return null;
  const next = state.redoStack.pop();
  state.undoStack.push({ text: currentDoc.text, cursor: currentDoc.cursor });
  return next;
}

// Entering Insert pushes a pre-insert snapshot for edit coalescing. If the user
// leaves Insert without changing anything, drop that snapshot so `u` isn't a
// no-op. (Called by the DOM layer on insert-exit, since typing happens live.)
export function dropRedundantUndo(state, currentText) {
  const top = state.undoStack[state.undoStack.length - 1];
  if (top && top.text === currentText) state.undoStack.pop();
}
