// dom/mode-indicator.js — a small fixed badge showing the current mode.

import { Mode } from "../engine/state.js";

const LABEL = {
  [Mode.NORMAL]: "-- NORMAL --",
  [Mode.INSERT]: "-- INSERT --",
  [Mode.VISUAL]: "-- VISUAL --",
  [Mode.VISUAL_LINE]: "-- VISUAL LINE --",
};

const COLOR = {
  [Mode.NORMAL]: "#0b6e4f",
  [Mode.INSERT]: "#1e6fd6",
  [Mode.VISUAL]: "#c0791a",
  [Mode.VISUAL_LINE]: "#c0791a",
};

let el = null;

function ensure() {
  if (el) return el;
  el = document.createElement("div");
  el.id = "vimtext-mode-indicator";
  Object.assign(el.style, {
    position: "fixed",
    bottom: "12px",
    left: "12px",
    zIndex: "2147483647",
    font: "600 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
    color: "#fff",
    padding: "3px 8px",
    borderRadius: "4px",
    pointerEvents: "none",
    letterSpacing: "0.5px",
    boxShadow: "0 1px 4px rgba(0,0,0,.3)",
    opacity: "0.95",
  });
  (document.body || document.documentElement).appendChild(el);
  return el;
}

export function show(mode) {
  const node = ensure();
  node.textContent = LABEL[mode] || "";
  node.style.background = COLOR[mode] || "#333";
  node.style.display = "block";
}

export function hide() {
  if (el) el.style.display = "none";
}
