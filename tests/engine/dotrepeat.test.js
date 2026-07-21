import { test } from "node:test";
import assert from "node:assert/strict";
import { createState, Mode } from "../../content-scripts/engine/state.js";
import { handleKey, finishInsertRecording } from "../../content-scripts/engine/keymap.js";

const norm = (tok) => (tok === "Esc" ? { key: "Escape" } : { key: tok });

function press(state, doc, tok, opts) {
  const r = handleKey(state, doc, norm(tok), opts);
  return { text: r.text, cursor: r.cursor };
}
function seq(state, doc, tokens, opts) {
  for (const t of tokens) doc = press(state, doc, t, opts);
  return doc;
}
// Mimic the DOM: the browser types `typed` during insert, then Esc exits and
// the DOM hands the typed text to the engine.
function insertAndEscape(state, doc, typed, opts) {
  const text = doc.text.slice(0, doc.cursor) + typed + doc.text.slice(doc.cursor);
  const r = handleKey(state, { text, cursor: doc.cursor + typed.length }, norm("Esc"), opts);
  finishInsertRecording(state, typed);
  return { text: r.text, cursor: r.cursor };
}

test(". repeats x", () => {
  const s = createState();
  let doc = { text: "abcde", cursor: 0 };
  doc = seq(s, doc, ["x", ".", "."]);
  assert.equal(doc.text, "de");
});

test(". repeats dw", () => {
  const s = createState();
  let doc = seq(s, { text: "one two three", cursor: 0 }, ["d", "w", "."]);
  assert.equal(doc.text, "three");
});

test("count before . overrides the original count", () => {
  const s = createState();
  let doc = seq(s, { text: "aaaaa", cursor: 0 }, ["x", "3", "."]);
  assert.equal(doc.text, "a");
});

test(". repeats a change that includes inserted text (ciw)", () => {
  const s = createState();
  let doc = seq(s, { text: "aaa bbb", cursor: 0 }, ["c", "i", "w"]);
  assert.equal(s.mode, Mode.INSERT);
  doc = insertAndEscape(s, doc, "foo");
  assert.equal(doc.text, "foo bbb");
  doc = press(s, doc, "w"); // onto "bbb"
  doc = press(s, doc, ".");
  assert.equal(doc.text, "foo foo");
});

test(". repeats A;<Esc> on the next line", () => {
  const s = createState();
  let doc = seq(s, { text: "l1\nl2", cursor: 0 }, ["A"]);
  doc = insertAndEscape(s, doc, ";");
  assert.equal(doc.text, "l1;\nl2");
  doc = press(s, doc, "j");
  doc = press(s, doc, ".");
  assert.equal(doc.text, "l1;\nl2;");
});

test(". repeats a surround (ysiw))", () => {
  const ON = { plugins: { surround: true, targets: true } };
  const s = createState();
  let doc = seq(s, { text: "foo bar", cursor: 0 }, ["y", "s", "i", "w", ")"], ON);
  assert.equal(doc.text, "(foo) bar");
  doc = seq(s, doc, ["w", "w", "w"], ON); // onto "bar"
  doc = press(s, doc, ".", ON);
  assert.equal(doc.text, "(foo) (bar)");
});

test("u is not itself repeatable; . repeats the last real change", () => {
  const s = createState();
  let doc = seq(s, { text: "abcde", cursor: 0 }, ["x", "u"]); // delete then undo
  assert.equal(doc.text, "abcde");
  doc = press(s, doc, "."); // repeats the x, not the u
  assert.equal(doc.text, "bcde");
});
