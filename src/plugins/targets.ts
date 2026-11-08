import type { CodeMirrorV, EngineApi, MotionFn, vimKey } from "../engine/pluginApi";
import { enclosingPair, matchingClose, matchingOpen } from "./pairs";
import type { Plugin, PluginContext } from "./Plugin";

/**
 * targets (oracle: targets.vim's `doc/targets.txt` with its default settings;
 * DESIGN.md "Plugins"). The exact object keys (`i(`, `a"`, `ia`, …) are bound
 * in front of the engine's `i<register>`/`a<register>` for those keys only and
 * Seek (GLOSSARY.md) when the cursor is not inside the object; typed `in`,
 * `an`, `il`, `al` reach the engine as Plugin Keys through the bridge's hook,
 * and the object key that follows completes them as the binding's
 * `<character>`. Every object is one engine motion returning a range, so an
 * operator, Visual mode, a count and `.` are the engine's.
 */

// --- Spans and targets ---

/** A span of the document, by offsets, end exclusive. */
interface Span {
  from: number;
  to: number;
}

/**
 * One text object candidate: `raw` is the whole object with its delimiters
 * (what the Seek ranks), `inner` and `around` what `i` and `a` select.
 */
interface Target {
  raw: Span;
  inner: Span;
  around: Span;
}

/** A found object as the offsets of its two delimiters, or null. */
type Found = [number, number] | null;

function pairTarget(found: Found): Target | null {
  if (!found) return null;
  const [open, close] = found;
  return {
    raw: { from: open, to: close + 1 },
    inner: { from: open + 1, to: close },
    around: { from: open, to: close + 1 },
  };
}

// --- Pair objects (targets.txt "pair text objects") ---

/** The bracket pairs by trigger character; `b` is the parentheses (Vim's alias; targets' any-block is not in v1) and `B` the braces. */
const PAIRS: Record<string, readonly [string, string]> = {
  "(": ["(", ")"],
  ")": ["(", ")"],
  b: ["(", ")"],
  "{": ["{", "}"],
  "}": ["{", "}"],
  B: ["{", "}"],
  "[": ["[", "]"],
  "]": ["[", "]"],
  "<": ["<", ">"],
  ">": ["<", ">"],
};

/** The `count`-th pair around `at`, growing outward; the bracket under the cursor counts as its own pair. */
function pairAround(text: string, at: number, open: string, close: string, count: number): Found {
  let found: Found = null;
  for (let n = 0; n < count; n++) {
    found = enclosingPair(text, at, open, close);
    if (!found) return null;
    at = found[0] - 1;
  }
  return found;
}

/** The `count`-th balanced pair opening after `at`. */
function pairNext(text: string, at: number, open: string, close: string, count: number): Found {
  let i = at;
  for (;;) {
    i = text.indexOf(open, i + 1);
    if (i < 0) return null;
    const j = matchingClose(text, i, open, close);
    if (j >= 0 && --count === 0) return [i, j];
  }
}

/** The `count`-th balanced pair closing before `at`. */
function pairLast(text: string, at: number, open: string, close: string, count: number): Found {
  let j = at;
  for (;;) {
    j = j <= 0 ? -1 : text.lastIndexOf(close, j - 1);
    if (j < 0) return null;
    const i = matchingOpen(text, j, open, close);
    if (i >= 0 && --count === 0) return [i, j];
  }
}

// --- The Seek (targets.txt "g:targets_seekRanges", the default order) ---

/**
 * The default seek ranges, two letters for where an object's start and end
 * sit relative to the cursor: `c` on it, `l`/`r` left/right on its line,
 * `a`/`b` above/below it. The hidden mirror has no screen, so the ranges the
 * doc tells apart by visibility (`A`/`B`) fold into `a`/`b`.
 */
const SEEK_RANGES = [
  "cc",
  "cr",
  "cb",
  "lc",
  "ac",
  "lr",
  "rr",
  "ll",
  "lb",
  "ar",
  "ab",
  "rb",
  "al",
  "bb",
  "aa",
];

function rangeType(cm: CodeMirrorV, span: Span, cursor: number): string {
  const line = cm.posFromIndex(cursor).line;
  const where = (at: number): string => {
    if (at === cursor) return "c";
    const sameLine = cm.posFromIndex(at).line === line;
    return at < cursor ? (sameLine ? "l" : "a") : sameLine ? "r" : "b";
  };
  return where(span.from) + where(span.to - 1);
}

/** The candidate whose range comes first in the default seek order; null when none is found. */
function seek(cm: CodeMirrorV, cursor: number, candidates: Array<Target | null>): Target | null {
  let best: Target | null = null;
  let bestRank = SEEK_RANGES.length;
  for (const target of candidates) {
    if (!target) continue;
    const rank = SEEK_RANGES.indexOf(rangeType(cm, target.raw, cursor));
    if (rank >= 0 && rank < bestRank) {
      best = target;
      bestRank = rank;
    }
  }
  return best;
}

// --- The motions ---

type Which = "seek" | "next" | "last";

interface Query {
  text: string;
  cursor: number;
  count: number;
  /** The Visual selection when there is one wider than the cursor, by offsets; the object grows past it. */
  selection: Span | null;
}

function contains(outer: Span, inner: Span): boolean {
  return outer.from <= inner.from && inner.to <= outer.to;
}

function findPair(
  cm: CodeMirrorV,
  q: Query,
  open: string,
  close: string,
  which: Which,
  inner: boolean,
): Target | null {
  const { text, cursor } = q;
  if (which === "next") return pairTarget(pairNext(text, cursor, open, close, q.count));
  if (which === "last") return pairTarget(pairLast(text, cursor, open, close, q.count));
  let count = q.count;
  let around = pairTarget(pairAround(text, cursor, open, close, count));
  // In Visual the same object typed again grows to the enclosing one.
  while (around && q.selection && contains(q.selection, inner ? around.inner : around.around)) {
    around = pairTarget(pairAround(text, cursor, open, close, ++count));
  }
  if (q.count > 1) return around;
  return seek(cm, cursor, [
    around,
    pairTarget(pairNext(text, cursor, open, close, 1)),
    pairTarget(pairLast(text, cursor, open, close, 1)),
  ]);
}

// --- Quote objects (targets.txt "quote text objects") ---

const QUOTES = new Set(['"', "'", "`"]);

/** The proper strings of a line: its quotes paired from the start, as the offsets of both quotes in the line. */
function quotePairs(line: string, quote: string): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  let open = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== quote) continue;
    if (open < 0) open = i;
    else {
      pairs.push([open, i]);
      open = -1;
    }
  }
  return pairs;
}

/** `a"` takes the quotes and, unlike Vim's, no surrounding whitespace (targets.txt). */
function quoteTarget(base: number, pair: [number, number] | undefined): Target | null {
  return pair ? pairTarget([base + pair[0], base + pair[1]]) : null;
}

/**
 * The implicit Seek for a quote stays on the cursor's line (targets.txt
 * "quote seek"); `n`/`l` walk the lines after or before it, the `count`-th
 * string counting.
 */
function findQuote(cm: CodeMirrorV, q: Query, quote: string, which: Which): Target | null {
  const { line, ch } = cm.posFromIndex(q.cursor);
  const base = q.cursor - ch;
  const here = quotePairs(cm.getLine(line), quote);
  if (which === "seek") {
    return seek(cm, q.cursor, [
      quoteTarget(
        base,
        here.find(([o, c]) => o <= ch && ch <= c),
      ),
      quoteTarget(
        base,
        here.find(([o]) => o > ch),
      ),
      quoteTarget(base, here.filter(([, c]) => c < ch).pop()),
    ]);
  }
  let count = q.count;
  if (which === "next") {
    let candidates = here.filter(([o]) => o > ch);
    for (let l = line, lineBase = base; ;) {
      if (count <= candidates.length) return quoteTarget(lineBase, candidates[count - 1]);
      count -= candidates.length;
      if (++l > cm.lastLine()) return null;
      lineBase = cm.indexFromPos({ line: l, ch: 0 });
      candidates = quotePairs(cm.getLine(l), quote);
    }
  }
  let candidates = here.filter(([, c]) => c < ch);
  for (let l = line, lineBase = base; ;) {
    if (count <= candidates.length) return quoteTarget(lineBase, candidates[candidates.length - count]);
    count -= candidates.length;
    if (--l < 0) return null;
    lineBase = cm.indexFromPos({ line: l, ch: 0 });
    candidates = quotePairs(cm.getLine(l), quote);
  }
}

// --- Argument objects (targets.txt "argument text objects": `(`/`[` open a list, `,` separates) ---

const ARGUMENT = "a";
const ARG_OPEN = "([";
const ARG_CLOSE = ")]";
const ARG_SEP = ",";

/** Scans back from `at` for an argument's opening delimiter (a separator or an opening bracket at depth 0); -1 at the text's start. */
function argOpenBefore(text: string, at: number): number {
  let depth = 0;
  for (let i = at; i >= 0; i--) {
    const c = text[i]!;
    if (ARG_CLOSE.includes(c)) depth++;
    else if (ARG_OPEN.includes(c)) {
      if (depth === 0) return i;
      depth--;
    } else if (c === ARG_SEP && depth === 0) return i;
  }
  return -1;
}

/** Scans forward from `at` for an argument's closing delimiter (a separator or a closing bracket at depth 0); -1 at the text's end. */
function argCloseAfter(text: string, at: number): number {
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    const c = text[i]!;
    if (ARG_OPEN.includes(c)) depth++;
    else if (ARG_CLOSE.includes(c)) {
      if (depth === 0) return i;
      depth--;
    } else if (c === ARG_SEP && depth === 0) return i;
  }
  return -1;
}

/** The brackets of the list an argument with these delimiters belongs to; null when it is in none. */
function listBrackets(text: string, open: number, close: number): [number, number] | null {
  let i = open;
  while (i >= 0 && !ARG_OPEN.includes(text[i]!)) i = argOpenBefore(text, i - 1);
  let j = close;
  while (j >= 0 && !ARG_CLOSE.includes(text[j]!)) j = argCloseAfter(text, j + 1);
  return i < 0 || j < 0 ? null : [i, j];
}

/**
 * The argument between the delimiters `open` and `close`. `ia` is everything
 * between them; `aa` leaves a proper list behind: an argument after a
 * separator takes that separator and its own trailing whitespace, the first
 * argument of a list starts at its first non-blank and takes the separator and
 * the whitespace after it instead (targets.txt's argument chart).
 */
function argumentTarget(text: string, found: Found): Target | null {
  if (!found || !listBrackets(text, found[0], found[1])) return null;
  const [open, close] = found;
  let around: Span;
  if (text[open] === ARG_SEP) around = { from: open, to: close };
  else {
    let from = open + 1;
    while (from < close && /\s/.test(text[from]!)) from++;
    let to = close;
    if (text[close] === ARG_SEP) {
      to = close + 1;
      while (to < text.length && /\s/.test(text[to]!)) to++;
    }
    around = { from, to };
  }
  return { raw: { from: open, to: close + 1 }, inner: { from: open + 1, to: close }, around };
}

/** The argument at `at`: on a delimiter, the argument it opens (a separator or opening bracket) or closes. */
function argumentAround(text: string, at: number): Found {
  const c = text[at] ?? "";
  let open: number;
  let close: number;
  if (c === ARG_SEP || ARG_OPEN.includes(c)) {
    open = at;
    close = argCloseAfter(text, at + 1);
  } else if (ARG_CLOSE.includes(c)) {
    close = at;
    open = argOpenBefore(text, at - 1);
  } else {
    open = argOpenBefore(text, at - 1);
    close = argCloseAfter(text, at + 1);
  }
  return open < 0 || close < 0 ? null : [open, close];
}

/** The argument whose list holds the argument `found`: one count bigger. */
function argumentEnclosing(text: string, found: Found): Found {
  const list = found && listBrackets(text, found[0], found[1]);
  if (!list) return null;
  const open = argOpenBefore(text, list[0] - 1);
  const close = argCloseAfter(text, list[1] + 1);
  return open < 0 || close < 0 ? null : [open, close];
}

/** The `count`-th argument opening after `at` (at a separator or an opening bracket) that is in a list. */
function argumentNext(text: string, at: number, count: number): Target | null {
  for (let d = at + 1; d < text.length; d++) {
    const c = text[d]!;
    if (c !== ARG_SEP && !ARG_OPEN.includes(c)) continue;
    const close = argCloseAfter(text, d + 1);
    const target = close < 0 ? null : argumentTarget(text, [d, close]);
    if (target && --count === 0) return target;
  }
  return null;
}

/** The `count`-th argument closing before `at` (at a separator or a closing bracket) that is in a list. */
function argumentLast(text: string, at: number, count: number): Target | null {
  for (let d = at - 1; d >= 0; d--) {
    const c = text[d]!;
    if (c !== ARG_SEP && !ARG_CLOSE.includes(c)) continue;
    const open = argOpenBefore(text, d - 1);
    const target = open < 0 ? null : argumentTarget(text, [open, d]);
    if (target && --count === 0) return target;
  }
  return null;
}

function findArgument(cm: CodeMirrorV, q: Query, which: Which, inner: boolean): Target | null {
  const { text, cursor } = q;
  if (which === "next") return argumentNext(text, cursor, q.count);
  if (which === "last") return argumentLast(text, cursor, q.count);
  const grow = (found: Found, count: number): Found => {
    for (let n = 1; found && n < count; n++) found = argumentEnclosing(text, found);
    return found;
  };
  let count = q.count;
  let around = argumentTarget(text, grow(argumentAround(text, cursor), count));
  while (around && q.selection && contains(q.selection, inner ? around.inner : around.around)) {
    around = argumentTarget(text, grow(argumentAround(text, cursor), ++count));
  }
  if (q.count > 1) return around;
  return seek(cm, cursor, [around, argumentNext(text, cursor, 1), argumentLast(text, cursor, 1)]);
}

function findTarget(cm: CodeMirrorV, q: Query, char: string, which: Which, inner: boolean): Target | null {
  const pair = PAIRS[char];
  if (pair) return findPair(cm, q, pair[0], pair[1], which, inner);
  if (QUOTES.has(char)) return findQuote(cm, q, char, which);
  if (char === ARGUMENT) return findArgument(cm, q, which, inner);
  return null;
}

/**
 * The object as a motion: a range for the operator (end exclusive), or in
 * Visual the selection's new ends (head on the last character). Null when
 * there is no such object, which cancels the operator and leaves Normal mode.
 */
function objectMotion(which: Which): MotionFn {
  return (cm, head, motionArgs, vim) => {
    const char = motionArgs.selectedCharacter;
    if (!char) return null;
    const inner = !!motionArgs.textObjectInner;
    const cursor = cm.indexFromPos(head);
    let selection: Span | null = null;
    if (vim.visualMode) {
      const anchor = cm.indexFromPos(vim.sel.anchor);
      if (anchor !== cursor) selection = { from: Math.min(anchor, cursor), to: Math.max(anchor, cursor) + 1 };
    }
    const q: Query = { text: cm.getValue(), cursor, count: motionArgs.repeat || 1, selection };
    const target = findTarget(cm, q, char, which, inner);
    if (!target) return null;
    const span = inner ? target.inner : target.around;
    if (!vim.visualMode) return [cm.posFromIndex(span.from), cm.posFromIndex(span.to)];
    if (span.to <= span.from) return null; // an empty object cannot be a selection
    return [cm.posFromIndex(span.from), cm.posFromIndex(span.to - 1)];
  };
}

// --- Bindings ---

/** Every key `i`/`a` is bound for: the four pairs by both brackets and their alias, the quotes, the argument. */
const OBJECT_KEYS = [...Object.keys(PAIRS), ...QUOTES, ARGUMENT];

const BINDINGS: vimKey[] = [
  ...OBJECT_KEYS.flatMap((key): vimKey[] => [
    {
      keys: `i${key}`,
      type: "motion",
      motion: "targetsObject",
      motionArgs: { textObjectInner: true, selectedCharacter: key },
    },
    { keys: `a${key}`, type: "motion", motion: "targetsObject", motionArgs: { selectedCharacter: key } },
  ]),
  {
    keys: "<TargetsIn><character>",
    type: "motion",
    motion: "targetsNextObject",
    motionArgs: { textObjectInner: true },
  },
  { keys: "<TargetsAn><character>", type: "motion", motion: "targetsNextObject" },
  {
    keys: "<TargetsIl><character>",
    type: "motion",
    motion: "targetsLastObject",
    motionArgs: { textObjectInner: true },
  },
  { keys: "<TargetsAl><character>", type: "motion", motion: "targetsLastObject" },
];

const SEEK_RULES = (context: PluginContext) => [
  { context, typed: "in", key: "TargetsIn" },
  { context, typed: "an", key: "TargetsAn" },
  { context, typed: "il", key: "TargetsIl" },
  { context, typed: "al", key: "TargetsAl" },
];

let defined = false;

export const targets: Plugin = {
  keys: [...SEEK_RULES("operator-pending"), ...SEEK_RULES("visual")],

  define(engine: EngineApi) {
    if (defined) return;
    defined = true;
    engine.defineMotion("targetsObject", objectMotion("seek"));
    engine.defineMotion("targetsNextObject", objectMotion("next"));
    engine.defineMotion("targetsLastObject", objectMotion("last"));
  },

  bind(engine) {
    for (const command of BINDINGS) engine.bindKey(command);
  },
};
