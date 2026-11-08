/**
 * The enclosing `open`…`close` pair of offset `at` in `text`, nesting
 * respected, the bracket under the cursor counting as its own pair (Vim's
 * `a(` on the bracket itself); null when there is none. Shared by the
 * surround and targets Plugins, whose bracket targets agree on this.
 */
export function enclosingPair(
  text: string,
  at: number,
  open: string,
  close: string,
): [number, number] | null {
  let openAt = -1;
  if (text[at] === open) openAt = at;
  else {
    let depth = 0;
    for (let i = at - 1; i >= 0; i--) {
      const c = text[i];
      if (c === close) depth++;
      else if (c === open) {
        if (depth === 0) {
          openAt = i;
          break;
        }
        depth--;
      }
    }
    if (openAt < 0) return null;
  }
  const closeAt = matchingClose(text, openAt, open, close);
  return closeAt < 0 ? null : [openAt, closeAt];
}

/** The offset of the `close` matching the `open` at `openAt`, nesting respected; -1 when unbalanced. */
export function matchingClose(text: string, openAt: number, open: string, close: string): number {
  let depth = 0;
  for (let j = openAt + 1; j < text.length; j++) {
    const c = text[j];
    if (c === open) depth++;
    else if (c === close) {
      if (depth === 0) return j;
      depth--;
    }
  }
  return -1;
}

/** The offset of the `open` matching the `close` at `closeAt`, nesting respected; -1 when unbalanced. */
export function matchingOpen(text: string, closeAt: number, open: string, close: string): number {
  let depth = 0;
  for (let i = closeAt - 1; i >= 0; i--) {
    const c = text[i];
    if (c === close) depth++;
    else if (c === open) {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}
