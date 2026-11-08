/**
 * What the surround and targets Plugins share about bracket pairs: the pairs
 * themselves and how a balanced one is found around an offset, nesting
 * respected. Their bracket targets agree on all of it.
 */

/** A span of the document, by offsets, end exclusive. */
export interface Span {
  from: number;
  to: number;
}

/** The two characters of a bracket pair; they travel together. */
export interface Pair {
  open: string;
  close: string;
}

const PARENTHESES: Pair = { open: "(", close: ")" };
const BRACES: Pair = { open: "{", close: "}" };
const SQUARE: Pair = { open: "[", close: "]" };
const ANGLE: Pair = { open: "<", close: ">" };

/** The bracket pairs by the character that names one: either bracket, or Vim's aliases `b` (parentheses) and `B` (braces). */
export const BRACKETS: Record<string, Pair> = {
  "(": PARENTHESES,
  ")": PARENTHESES,
  b: PARENTHESES,
  "{": BRACES,
  "}": BRACES,
  B: BRACES,
  "[": SQUARE,
  "]": SQUARE,
  "<": ANGLE,
  ">": ANGLE,
};

/** The offset of the `close` matching the `open` at `openAt`, nesting respected; -1 when unbalanced. */
export function matchingClose(text: string, openAt: number, pair: Pair): number {
  let depth = 0;
  for (let j = openAt + 1; j < text.length; j++) {
    const c = text[j];
    if (c === pair.open) depth++;
    else if (c === pair.close) {
      if (depth === 0) return j;
      depth--;
    }
  }
  return -1;
}

/**
 * The offset of the `open` matching the `close` at `closeAt`, nesting
 * respected; for any other offset, the nearest `open` before it still open
 * there. -1 when there is none.
 */
export function matchingOpen(text: string, closeAt: number, pair: Pair): number {
  let depth = 0;
  for (let i = closeAt - 1; i >= 0; i--) {
    const c = text[i];
    if (c === pair.close) depth++;
    else if (c === pair.open) {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

/**
 * The offsets of the `count`-th pair enclosing offset `at`, growing outward,
 * the bracket under the cursor counting as its own pair (Vim's `a(` on the
 * bracket itself); null when there is none.
 */
export function enclosingPair(text: string, at: number, pair: Pair, count = 1): [number, number] | null {
  let found: [number, number] | null = null;
  for (let n = 0; n < count; n++) {
    const openAt = text[at] === pair.open ? at : matchingOpen(text, at, pair);
    if (openAt < 0) return null;
    const closeAt = matchingClose(text, openAt, pair);
    if (closeAt < 0) return null;
    found = [openAt, closeAt];
    at = openAt - 1;
  }
  return found;
}
