import { MONACO_ANSWER, MONACO_REQUEST, type MonacoAnswer, type MonacoRequest } from "./monacoProtocol";

/**
 * The longest answer read from the page world, in characters: about six times
 * the largest text the spike of #113 read (2.8 MB). A longer one is ignored
 * unparsed.
 */
export const MAX_ANSWER_LENGTH = 16 * 2 ** 20;

function isOffset(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

/**
 * The answer in `detail`, or null. The page world is the page's: what comes
 * back is untrusted (ADR 0010), so only a JSON string of the expected shape is
 * taken, a selection as two offsets and at most a text they fit in, and only
 * those fields are kept.
 */
function parseAnswer(detail: unknown, wantsText: boolean): MonacoAnswer | null {
  if (typeof detail !== "string" || detail.length > MAX_ANSWER_LENGTH) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const { anchor, head, text } = parsed as Record<string, unknown>;
  if (wantsText) {
    if (typeof text !== "string" || !isOffset(anchor, text.length) || !isOffset(head, text.length))
      return null;
    return { anchor, head, text };
  }
  if (!isOffset(anchor, Number.MAX_SAFE_INTEGER) || !isOffset(head, Number.MAX_SAFE_INTEGER)) return null;
  return { anchor, head };
}

/**
 * Asks VimText's page-world script about the Monaco editor whose input `el`
 * is, and returns its answer, or null when none came or it was not one: no
 * page-world script, no `window.monaco`, no writable code editor around `el`.
 * Synchronous: the page-world listener runs, and dispatches its answer, inside
 * `dispatchEvent` (docs/engine-seams.md, "Monaco: the page-world round trip").
 */
export function askMonaco(el: HTMLElement, request: MonacoRequest): MonacoAnswer | null {
  let answer: MonacoAnswer | null = null;
  let answers = 0;
  const onAnswer = (e: Event) => {
    answers++;
    answer = parseAnswer((e as CustomEvent<unknown>).detail, request.op === "read");
  };
  el.addEventListener(MONACO_ANSWER, onAnswer);
  try {
    el.dispatchEvent(
      new CustomEvent(MONACO_REQUEST, { detail: JSON.stringify(request), bubbles: true, composed: true }),
    );
  } finally {
    el.removeEventListener(MONACO_ANSWER, onAnswer);
  }
  // One request has one answer: more than one is not VimText's script alone.
  return answers === 1 ? answer : null;
}
