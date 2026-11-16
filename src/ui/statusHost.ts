/**
 * The Status Line host's tag. Everything in its shadow root (the command line,
 * the hidden mirror, the drawn Cursor) is VimText's own UI, never a Field
 * (#78). A leaf module, so `src/field` can ask without depending on the UI.
 */
export const STATUS_HOST_TAG = "vimtext-status";

/** True for a Status Line host element. */
export function isStatusHost(node: Node): boolean {
  return node instanceof Element && node.localName === STATUS_HOST_TAG;
}
