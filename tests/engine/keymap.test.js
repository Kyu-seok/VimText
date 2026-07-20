import { test } from "node:test";
import assert from "node:assert/strict";
import { createState, Mode } from "../../content-scripts/engine/state.js";
import { handleKey, performSearch } from "../../content-scripts/engine/keymap.js";

// Turn a compact token into a normalized key object.
//   "Esc" -> Escape, "C-[" -> Ctrl+[, "C-r" -> Ctrl+r, else a literal char.
function norm(tok) {
  if (tok === "Esc") return { key: "Escape" };
  if (tok.startsWith("C-")) return { key: tok.slice(2), ctrl: true };
  return { key: tok };
}

// Feed a sequence of tokens; return the final { state, doc, res }.
function run(text, cursor, tokens, opts = {}) {
  const state = createState();
  let doc = { text, cursor };
  let res;
  for (const tok of tokens) {
    res = handleKey(state, doc, norm(tok), opts);
    doc = { text: res.text, cursor: res.cursor };
  }
  return { state, doc, res };
}

test("hjkl move the cursor in Normal mode", () => {
  assert.equal(run("abc\ndef", 0, ["l", "l"]).doc.cursor, 2);
  assert.equal(run("abc\ndef", 0, ["l", "l", "l"]).doc.cursor, 2); // clamps at last char
  assert.equal(run("abc\ndef", 0, ["j"]).doc.cursor, 4);
});

test("i enters Insert, Esc returns to Normal one char left", () => {
  const { state, res } = run("abc", 1, ["i"]);
  assert.equal(state.mode, Mode.INSERT);
  assert.deepEqual(res.effect, { type: "insert-enter" });
  const back = run("abc", 1, ["i", "Esc"]);
  assert.equal(back.state.mode, Mode.NORMAL);
  assert.equal(back.doc.cursor, 0);
});

test("Ctrl+[ also returns to Normal", () => {
  const { state } = run("abc", 0, ["i", "C-["]);
  assert.equal(state.mode, Mode.NORMAL);
});

test("x deletes the char under the cursor", () => {
  assert.equal(run("abc", 0, ["x"]).doc.text, "bc");
});

test("dw / de / cw", () => {
  assert.equal(run("hello world", 0, ["d", "w"]).doc.text, "world");
  assert.equal(run("hello world", 0, ["d", "e"]).doc.text, " world");
  const cw = run("hello world", 0, ["c", "w"]);
  assert.equal(cw.doc.text, " world"); // cw acts like ce
  assert.equal(cw.state.mode, Mode.INSERT);
});

test("counts: 3dw", () => {
  assert.equal(run("one two three four", 0, ["3", "d", "w"]).doc.text, "four");
});

test("dd / cc / yy", () => {
  assert.equal(run("abc\ndef\nghi", 0, ["d", "d"]).doc.text, "def\nghi");
  const cc = run("abc\ndef", 0, ["c", "c"]);
  assert.equal(cc.doc.text, "\ndef");
  assert.equal(cc.state.mode, Mode.INSERT);
  assert.equal(run("abc\ndef", 0, ["y", "y", "p"]).doc.text, "abc\nabc\ndef");
});

test("2dd deletes two lines", () => {
  assert.equal(run("a\nb\nc\nd", 0, ["2", "d", "d"]).doc.text, "c\nd");
});

test("visual charwise delete", () => {
  const { doc, state } = run("hello", 0, ["v", "l", "l", "d"]);
  assert.equal(doc.text, "lo");
  assert.equal(state.mode, Mode.NORMAL);
});

test("visual line delete", () => {
  assert.equal(run("abc\ndef\nghi", 0, ["V", "j", "d"]).doc.text, "ghi");
});

test("undo and redo", () => {
  assert.equal(run("abc", 0, ["x", "u"]).doc.text, "abc");
  assert.equal(run("abc", 0, ["x", "u", "C-r"]).doc.text, "bc");
});

test("undo coalesces a whole delete, not one char at a time", () => {
  // 3dw is one change -> one undo restores everything
  assert.equal(run("one two three four", 0, ["3", "d", "w", "u"]).doc.text, "one two three four");
});

test("G / {count}G navigation", () => {
  assert.equal(run("l1\nl2\nl3\nl4", 0, ["G"]).doc.cursor, 9);
  assert.equal(run("l1\nl2\nl3\nl4", 0, ["2", "G"]).doc.cursor, 3);
});

test("search: performSearch then n wraps", () => {
  const state = createState();
  const s1 = performSearch(state, { text: "foo bar foo", cursor: 0 }, "foo", true);
  assert.equal(s1.cursor, 8);
  const nRes = handleKey(state, { text: "foo bar foo", cursor: 8 }, norm("n"));
  assert.equal(nRes.cursor, 0); // wrapped back to the first match
});

test("/ opens the search UI via an effect", () => {
  const res = handleKey(createState(), { text: "abc", cursor: 0 }, norm("/"));
  assert.deepEqual(res.effect, { type: "search-open" });
});

test("single-line input: j/k no-op, o falls back to append", () => {
  const opts = { singleLine: true };
  assert.equal(run("hello", 0, ["j"], opts).doc.cursor, 0);
  const o = run("hello", 0, ["o"], opts);
  assert.equal(o.state.mode, Mode.INSERT);
  assert.equal(o.doc.cursor, 1); // like 'a'
  assert.equal(o.doc.text, "hello"); // no newline added
});

test("unmapped Normal keys are swallowed, not leaked", () => {
  const res = handleKey(createState(), { text: "abc", cursor: 0 }, norm("z"));
  assert.equal(res.handled, true);
  assert.equal(res.text, "abc");
});
