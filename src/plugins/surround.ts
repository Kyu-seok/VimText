import type { CodeMirrorV, EngineApi, OperatorFn, Pos, vimKey } from "../engine/pluginApi";
import { BRACKETS, enclosingPair, type Pair, type Span } from "./pairs";
import type { Plugin } from "./Plugin";

/**
 * surround (oracle: vim-surround's `doc/surround.txt`; DESIGN.md "Plugins").
 * Typed `ys`, `yss`, `cs`, `ds` in Normal and `S` in Visual reach the engine as
 * Plugin Keys through the bridge's hook; everything they mean is defined here
 * as engine operators, motions and one action, and bound on every Activation.
 *
 * `ys{motion}` and `cs{old}` cannot finish on their own key: the character
 * that follows is the wait the engine has no notion of. The operator remembers
 * what it would change and arms a one-shot `<character>` catch-all binding at
 * the front of the keymap (the command matching seam in docs/engine-seams.md);
 * the next printable key completes it, and the engine's next `vim-command-done`
 * (Esc or any non-printable key resolves the catch-all to a clear) disarms it.
 */

// --- Targets and replacements (surround.txt "TARGETS", "REPLACEMENTS") ---

/** The bracket pairs as surround names them: either character, Vim's `b` `B`, and vim-surround's own aliases `r` `a`. */
const SURROUND_BRACKETS: Record<string, Pair> = { ...BRACKETS, r: BRACKETS["["]!, a: BRACKETS["<"]! };

/** The opening bracket as a target trims the inner whitespace; as a replacement it adds a space inside. */
const OPENING = new Set(["(", "{", "[", "<"]);

/**
 * What goes before and after the text for a replacement character, or null
 * for one this version leaves alone: `<` and `t` prompt for a tag in Vim (not
 * in v1, DESIGN.md accepted limitations) and a letter wraps with nothing.
 */
function delimiters(char: string): Pair | null {
  if (char === "<" || char === "t" || char === "T") return null;
  const pair = SURROUND_BRACKETS[char];
  if (pair) {
    const space = OPENING.has(char) ? " " : "";
    return { open: pair.open + space, close: space + pair.close };
  }
  if (/[\p{L}\p{N}]/u.test(char) || char === " ") return null;
  return { open: char, close: char };
}

/**
 * A same-character pair (a quote) on one line, as Vim's `i"` finds it: on the
 * character itself the quotes before it on the line decide whether it opens or
 * closes; otherwise the previous and the next, or the first pair after the
 * cursor when none precedes it.
 */
function sameCharPair(line: string, ch: number, char: string): [number, number] | null {
  let open: number;
  let close: number;
  if (line[ch] === char) {
    const before = line.slice(0, ch).split(char).length - 1;
    if (before % 2 === 0) {
      open = ch;
      close = line.indexOf(char, ch + 1);
    } else {
      open = line.lastIndexOf(char, ch - 1);
      close = ch;
    }
  } else {
    open = ch > 0 ? line.lastIndexOf(char, ch - 1) : -1;
    if (open < 0) {
      open = line.indexOf(char, ch + 1);
      close = open < 0 ? -1 : line.indexOf(char, open + 1);
    } else {
      close = line.indexOf(char, ch + 1);
    }
  }
  return open < 0 || close < 0 ? null : [open, close];
}

/** Offsets of the target pair's two delimiters for `ds`/`cs`, `count` pairs out for brackets; null when absent. */
function findTarget(cm: CodeMirrorV, head: Pos, char: string, count: number): [number, number] | null {
  const bracket = SURROUND_BRACKETS[char];
  if (bracket) return enclosingPair(cm.getValue(), cm.indexFromPos(head), bracket, count);
  // A letter names a word, sentence, paragraph or tag target: none in v1.
  if (/[\p{L}\p{N}]/u.test(char)) return null;
  const pair = sameCharPair(cm.getLine(head.line), head.ch, char);
  if (!pair) return null;
  const lineStart = cm.indexFromPos({ line: head.line, ch: 0 });
  return [lineStart + pair[0], lineStart + pair[1]];
}

// --- The one wait the engine cannot express: the character after ys{motion} and cs{old} ---

interface Wait {
  cm: CodeMirrorV;
  /** The document as it was: the spans are offsets into it, so a page rewrite of the Field in between (a Controlled Field) voids the wait. */
  doc: string;
  apply(char: string): Pos | null;
}

const CATCH_ALL: vimKey = {
  keys: "<character>",
  type: "action",
  action: "surroundReplacement",
  context: "normal",
};

let api: EngineApi | null = null;
let defined = false;
/** What the next character completes; consumed by the catch-all action, replaced by the next wait. */
let waiting: Wait | null = null;
/** The catch-all binding while it is in the keymap, with the mirror whose next command disarms it. */
let armed: { cm: CodeMirrorV; onDone: () => void } | null = null;
/** The last replacement characters, for a `.` replay of `ys` and `cs`. */
let lastWrapChar: string | undefined;
let lastChangeChar: string | undefined;

function disarm(): void {
  if (!armed) return;
  api?.unbindKey(CATCH_ALL.keys, CATCH_ALL.context!);
  armed.cm.off("vim-command-done", armed.onDone);
  armed = null;
}

/**
 * Arms the catch-all for the next key. The engine signals `vim-command-done`
 * for the next command whatever it is: a clear (Esc, a non-printable key), a
 * command a Pass-through key never produced, or the catch-all's own dispatch,
 * which signals before it calls the action; so the signal disarms and the
 * action, if it runs, finds `waiting` still set.
 */
function arm(wait: Wait): void {
  disarm();
  waiting = wait;
  const onDone = () => disarm();
  armed = { cm: wait.cm, onDone };
  wait.cm.on("vim-command-done", onDone);
  api?.bindKey(CATCH_ALL);
}

/** True inside a `.` replay of the operator that `args` belongs to (the Replay seam in docs/engine-seams.md). */
function repeating(cm: CodeMirrorV, args: object): boolean {
  return !!api?.replaying() && cm.state.vim.lastEditInputState?.operatorArgs === args;
}

// --- Editing ---

/** Replaces `span` with `text` and returns the cursor for it: the start, where vim-surround leaves it. */
function replaceSpan(cm: CodeMirrorV, span: Span, text: string): Pos {
  const from = cm.posFromIndex(span.from);
  cm.replaceRange(text, from, cm.posFromIndex(span.to));
  return from;
}

/**
 * Wraps `spans` (several only for a Visual block) with the delimiters of
 * `char`. Linewise, the delimiters take lines of their own, indented like the
 * first line (vim-surround's `V` form); charwise from Normal, trailing
 * whitespace of the motion is put back after the wrap.
 */
function wrapSpans(
  cm: CodeMirrorV,
  spans: Span[],
  char: string,
  linewise: boolean,
  keepTrailing: boolean,
): Pos | null {
  const d = delimiters(char);
  if (!d) return null;
  let cursor: Pos | null = null;
  for (const span of [...spans].reverse()) {
    let text = cm.getRange(cm.posFromIndex(span.from), cm.posFromIndex(span.to));
    let wrapped: string;
    if (linewise) {
      const indent = /^[ \t]*/.exec(text)![0];
      wrapped = `${indent}${d.open.trimEnd()}\n${text}\n${indent}${d.close.trimStart()}`;
    } else {
      let trailing = "";
      if (keepTrailing) {
        trailing = /[ \t]*$/.exec(text)![0];
        text = text.slice(0, text.length - trailing.length);
      }
      wrapped = d.open + text + d.close + trailing;
    }
    cursor = replaceSpan(cm, span, wrapped);
  }
  return cursor;
}

/** The span an operator was given: one range, start before end, a linewise range without its final newline. */
function spanOf(cm: CodeMirrorV, range: { anchor: Pos; head: Pos }, linewise: boolean): Span {
  const a = cm.indexFromPos(range.anchor);
  const b = cm.indexFromPos(range.head);
  const span = { from: Math.min(a, b), to: Math.max(a, b) };
  if (linewise && span.to > span.from && cm.getValue()[span.to - 1] === "\n") span.to--;
  return span;
}

/** The text inside a target pair, the inner whitespace trimmed when the target was the opening bracket. */
function inner(cm: CodeMirrorV, span: Span, target: string): string {
  const text = cm.getRange(cm.posFromIndex(span.from + 1), cm.posFromIndex(span.to - 1));
  return OPENING.has(target) ? text.trim() : text;
}

/**
 * `ys{motion}`, `yss`, Visual `S`: wraps the range. With the character known
 * (Visual `S{char}` is one binding; a `.` replay of `ys` has the last one) it
 * wraps at once; typed `ys` waits for it. A `.` replay of Visual `S` does
 * nothing: vim-surround does not repeat it (DESIGN.md accepted limitations).
 */
const wrap: OperatorFn = (cm, args, ranges, oldAnchor) => {
  const vim = cm.state.vim;
  const linewise = !!args.linewise;
  const keepTrailing = !vim.visualMode;
  const spans = ranges.map((r) => spanOf(cm, r, linewise));
  const first = cm.posFromIndex(spans[0]!.from);
  // Only Visual S{char} carries its character; in Normal, `selectedCharacter`
  // is the motion's (`iw`'s w, `f)`'s parenthesis), copied in by the engine.
  // The engine replays a Visual operator over a same-sized selection, so the
  // replay arrives here in Visual mode too.
  if (vim.visualMode && args.selectedCharacter !== undefined) {
    if (repeating(cm, args)) return oldAnchor;
    return wrapSpans(cm, spans, args.selectedCharacter, linewise, keepTrailing) ?? first;
  }
  if (repeating(cm, args)) {
    if (lastWrapChar !== undefined) wrapSpans(cm, spans, lastWrapChar, linewise, keepTrailing);
    return first;
  }
  arm({
    cm,
    doc: cm.getValue(),
    apply(char) {
      const at = wrapSpans(cm, spans, char, linewise, keepTrailing);
      if (at) lastWrapChar = char;
      return at;
    },
  });
  return oldAnchor;
};

/** `ds{old}`: the target pair's delimiters go, the (trimmed) inner text stays. */
const deleteSurroundings: OperatorFn = (cm, args, ranges) => {
  const span = spanOf(cm, ranges[0]!, false);
  return replaceSpan(cm, span, inner(cm, span, args.selectedCharacter ?? ""));
};

/** `cs{old}{new}`: as `ds`, then the new delimiters around the inner text; typed, it waits for `new`. */
const changeSurroundings: OperatorFn = (cm, args, ranges, oldAnchor) => {
  const span = spanOf(cm, ranges[0]!, false);
  const text = inner(cm, span, args.selectedCharacter ?? "");
  const change = (char: string): Pos | null => {
    const d = delimiters(char);
    return d ? replaceSpan(cm, span, d.open + text + d.close) : null;
  };
  if (repeating(cm, args)) {
    return lastChangeChar !== undefined ? (change(lastChangeChar) ?? oldAnchor) : oldAnchor;
  }
  arm({
    cm,
    doc: cm.getValue(),
    apply(char) {
      const at = change(char);
      if (at) lastChangeChar = char;
      return at;
    },
  });
  return oldAnchor;
};

const BINDINGS: vimKey[] = [
  { keys: "<SurroundYs>", type: "operator", operator: "surroundWrap", operatorArgs: {}, context: "normal" },
  {
    keys: "<SurroundYss>",
    type: "operatorMotion",
    operator: "surroundWrap",
    motion: "surroundLine",
    motionArgs: {},
    operatorArgs: {},
    context: "normal",
  },
  {
    keys: "<SurroundCs><character>",
    type: "operatorMotion",
    operator: "surroundChange",
    motion: "surroundTarget",
    motionArgs: { inclusive: true },
    operatorArgs: {},
    context: "normal",
  },
  {
    keys: "<SurroundDs><character>",
    type: "operatorMotion",
    operator: "surroundDelete",
    motion: "surroundTarget",
    motionArgs: { inclusive: true },
    operatorArgs: {},
    context: "normal",
  },
  {
    keys: "<SurroundS><character>",
    type: "operator",
    operator: "surroundWrap",
    operatorArgs: {},
    context: "visual",
  },
];

export const surround: Plugin = {
  keys: [
    { context: "normal", typed: "ys", key: "SurroundYs" },
    { context: "normal", typed: "yss", key: "SurroundYss" },
    { context: "normal", typed: "cs", key: "SurroundCs" },
    { context: "normal", typed: "ds", key: "SurroundDs" },
    { context: "visual", typed: "S", key: "SurroundS" },
  ],

  define(engine) {
    api = engine; // the one this Activation gave: the waits bind and unbind through it
    if (defined) return;
    defined = true;
    engine.defineOperator("surroundWrap", wrap);
    engine.defineOperator("surroundDelete", deleteSurroundings);
    engine.defineOperator("surroundChange", changeSurroundings);
    // yss: from the first non-blank to the end of the line (`count` lines), charwise.
    engine.defineMotion("surroundLine", (cm, head, motionArgs) => {
      const line = cm.getLine(head.line);
      const firstNonBlank = line.search(/\S/);
      const lastLine = Math.min(head.line + motionArgs.repeat - 1, cm.lastLine());
      return [
        { line: head.line, ch: firstNonBlank < 0 ? line.length : firstNonBlank },
        { line: lastLine, ch: cm.getLine(lastLine).length },
      ];
    });
    // ds/cs: the target pair's delimiters, or null, which cancels the operator with it.
    engine.defineMotion("surroundTarget", (cm, head, motionArgs) => {
      const char = motionArgs.selectedCharacter;
      if (!char) return null;
      const found = findTarget(cm, head, char, motionArgs.repeat);
      return found ? [cm.posFromIndex(found[0]), cm.posFromIndex(found[1])] : null;
    });
    // The catch-all: the character that completes a waiting ys or cs. Not an
    // edit of its own, so the recorded edit stays the operator and its motion.
    engine.defineAction("surroundReplacement", (cm, actionArgs) => {
      const wait = waiting;
      waiting = null;
      disarm();
      if (!wait || wait.cm !== cm || cm.getValue() !== wait.doc || !actionArgs.selectedCharacter) return;
      const at = wait.apply(actionArgs.selectedCharacter);
      if (at) cm.setCursor(at);
    });
  },

  bind(engine) {
    for (const command of BINDINGS) engine.bindKey(command);
  },

  onBlur() {
    waiting = null;
    disarm();
  },
};
