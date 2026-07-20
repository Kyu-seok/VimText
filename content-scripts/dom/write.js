// dom/write.js — write to a field so framework-controlled inputs notice.
//
// React (and Vue, etc.) override the `value` setter on the input/textarea
// prototype and track the last value themselves. Assigning `el.value = x`
// directly bypasses that tracking, so the framework re-renders and reverts our
// change. The fix: call the *native* prototype setter, then dispatch a bubbling
// `input` event so the framework's onChange runs and its state stays in sync.

function nativeValueSetter(el) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  return desc && desc.set;
}

export function setValue(el, value, selStart, selEnd = selStart) {
  const set = nativeValueSetter(el);
  if (set) set.call(el, value);
  else el.value = value; // last-resort fallback
  el.dispatchEvent(new Event("input", { bubbles: true }));
  setSelection(el, selStart, selEnd);
}

export function setSelection(el, start, end = start, direction = "none") {
  try {
    el.setSelectionRange(start, end, direction);
  } catch {
    // Some input types reject setSelectionRange; ignore.
  }
}
