// content-scripts/index.js — VimText entry point (ES module, dynamic-imported
// by loader.js). Wires a capture-phase keydown listener to the engine and the
// DOM renderers.

import { Mode, dropRedundantUndo, pushUndo } from "./engine/state.js";
import { handleKey, performSearch } from "./engine/keymap.js";
import {
  isEditable, isSingleLine, getState, hasState, isOwnUI,
} from "./dom/element-tracker.js";
import { setValue } from "./dom/write.js";
import { render as renderCursor } from "./dom/cursor.js";
import { show as showIndicator, hide as hideIndicator } from "./dom/mode-indicator.js";
import { openSearch } from "./dom/search-ui.js";

// Sites where Esc/"/" conflicts are severe or the editor is unsupported.
const DEFAULT_DISABLED = ["docs.google.com"];

let settings = { enabled: true, disabledSites: [] };
let siteEnabled = true;
let composing = false;

function refreshSiteEnabled() {
  const disabled = new Set([...(settings.disabledSites || []), ...DEFAULT_DISABLED]);
  siteEnabled = !!settings.enabled && !disabled.has(location.hostname);
  if (!siteEnabled) hideIndicator();
}

function loadSettings() {
  try {
    chrome.storage.sync.get({ enabled: true, disabledSites: [] }, (v) => {
      settings = v || settings;
      refreshSiteEnabled();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      if (changes.enabled) settings.enabled = changes.enabled.newValue;
      if (changes.disabledSites) settings.disabledSites = changes.disabledSites.newValue;
      refreshSiteEnabled();
    });
  } catch {
    // chrome.storage unavailable (e.g. in a bare test harness) — stay enabled.
  }
}

function docOf(el) {
  return { text: el.value, cursor: el.selectionStart ?? 0 };
}

function onKeyDown(e) {
  if (!siteEnabled) return;
  const el = e.target;
  if (isOwnUI(el) || !isEditable(el)) return;
  // Respect IME composition — never act mid-compose or CJK input breaks.
  if (composing || e.isComposing || e.keyCode === 229) return;
  // Ignore bare modifier presses.
  if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;

  const st = getState(el);
  const isEscCombo = e.key === "Escape" || (e.ctrlKey && e.key === "[");

  if (st.mode === Mode.INSERT) {
    // Insert mode is the safe default: only the mode-switch keys are ours.
    if (!isEscCombo) return;
  } else {
    // Normal/Visual: let unrelated browser shortcuts through (copy, paste,
    // devtools, reload-when-not-redo, etc.). We only own Ctrl+[ and Ctrl+r.
    if (e.metaKey || e.altKey) return;
    const isRedo = e.ctrlKey && (e.key === "r" || e.key === "R");
    if (e.ctrlKey && e.key !== "[" && !isRedo) return;
  }

  const key = { key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey };
  const res = handleKey(st, docOf(el), key, { singleLine: isSingleLine(el) });
  if (!res.handled) return;

  e.preventDefault();
  e.stopPropagation();
  applyResult(el, st, res);
}

function applyResult(el, st, res) {
  const effect = res.effect && res.effect.type;

  if (res.text !== el.value) {
    setValue(el, res.text, res.cursor, res.cursor);
  }

  if (effect === "insert-exit") {
    // Nothing typed during the insert session? Drop the pre-insert snapshot.
    dropRedundantUndo(st, el.value);
  } else if (effect === "search-open") {
    runSearch(el, st);
    return;
  }

  renderCursor(el, st, res.cursor);
  showIndicator(st.mode);
}

async function runSearch(el, st) {
  const from = el.selectionStart ?? 0;
  const pattern = await openSearch();
  el.focus();
  if (pattern) {
    const r = performSearch(st, { text: el.value, cursor: from }, pattern, true);
    renderCursor(el, st, r.cursor);
  } else {
    renderCursor(el, st, from);
  }
  showIndicator(st.mode);
}

function onFocusIn(e) {
  if (!siteEnabled) return;
  const el = e.target;
  if (isOwnUI(el) || !isEditable(el)) return;
  // First focus starts in Insert (pass-through) so VimText never surprises the
  // user; they opt into Normal mode with Esc / Ctrl+[.
  const fresh = !hasState(el);
  const st = getState(el);
  if (fresh) {
    st.mode = Mode.INSERT;
    // Baseline snapshot so the first (default) Insert session is undoable with
    // `u`; dropped again on Esc if nothing was actually typed.
    pushUndo(st, { text: el.value, cursor: el.selectionStart ?? 0 });
  }
  renderCursor(el, st, el.selectionStart ?? 0);
  showIndicator(st.mode);
}

function onFocusOut(e) {
  if (isOwnUI(e.target)) return;
  hideIndicator();
}

export function init() {
  loadSettings();
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("compositionstart", () => { composing = true; }, true);
  document.addEventListener("compositionend", () => { composing = false; }, true);
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("focusout", onFocusOut, true);
}
