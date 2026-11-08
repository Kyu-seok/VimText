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

function findTarget(cm: CodeMirrorV, q: Query, char: string, which: Which, inner: boolean): Target | null {
  const pair = PAIRS[char];
  if (pair) return findPair(cm, q, pair[0], pair[1], which, inner);
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
const OBJECT_KEYS = Object.keys(PAIRS);

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
