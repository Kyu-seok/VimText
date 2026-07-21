import { test } from "node:test";
import assert from "node:assert/strict";
import { createState, Mode } from "../../content-scripts/engine/state.js";
import { handleKey } from "../../content-scripts/engine/keymap.js";

function norm(tok) {
  if (tok === "Esc") return { key: "Escape" };
  if (tok.startsWith("C-")) return { key: tok.slice(2), ctrl: true };
  return { key: tok };
}
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

const ON = { plugins: { surround: true, targets: true } };

// ---- text objects (core, always on) ----

test("di( / ci\" / diw / daw with operators", () => {
  assert.equal(run("a(bcd)e", 3, ["d", "i", "("]).doc.text, "a()e");
  const ci = run('say "hi"', 5, ["c", "i", '"']);
  assert.equal(ci.doc.text, 'say ""');
  assert.equal(ci.state.mode, Mode.INSERT);
  assert.equal(run("foo bar", 5, ["d", "i", "w"]).doc.text, "foo ");
  assert.equal(run("foo bar", 5, ["d", "a", "w"]).doc.text, "foo");
});

test("visual text object selects then operates", () => {
  assert.equal(run("a(bcd)e", 3, ["v", "i", "(", "d"]).doc.text, "a()e");
});

test("di( is a no-op when not inside and targets is off", () => {
  const r = run("foo (bar)", 0, ["c", "i", "("], { plugins: {} });
  assert.equal(r.doc.text, "foo (bar)");
  assert.equal(r.state.mode, Mode.NORMAL);
});

// ---- vim-surround ----

test("ysiw) / yss) add surround", () => {
  assert.equal(run("foo bar", 0, ["y", "s", "i", "w", ")"], ON).doc.text, "(foo) bar");
  assert.equal(run("foo", 0, ["y", "s", "s", ")"], ON).doc.text, "(foo)");
  assert.equal(run("foo", 0, ["y", "s", "s", "("], ON).doc.text, "( foo )");
});

test("cs and ds", () => {
  assert.equal(run("(foo)", 2, ["c", "s", ")", "]"], ON).doc.text, "[foo]");
  assert.equal(run("( foo )", 3, ["d", "s", "("], ON).doc.text, "foo");
  assert.equal(run('a "b" c', 3, ["d", "s", '"'], ON).doc.text, "a b c");
});

test("visual S surrounds the selection", () => {
  assert.equal(run("foobar", 0, ["v", "l", "l", "S", ")"], ON).doc.text, "(foo)bar");
});

test("surround is gated off without the plugin", () => {
  assert.equal(run("foo", 0, ["y", "s", "s", ")"], { plugins: {} }).doc.text, "foo");
});

test("surround edit is undoable as one step", () => {
  assert.equal(run("foo", 0, ["y", "s", "s", ")", "u"], ON).doc.text, "foo");
});

// ---- targets.vim ----

test("targets: cin( operates on the next pair", () => {
  assert.equal(run("(a) (b)", 1, ["c", "i", "n", "("], ON).doc.text, "(a) ()");
});

test("targets: cil( operates on the previous pair", () => {
  assert.equal(run("(a) (b)", 5, ["c", "i", "l", "("], ON).doc.text, "() (b)");
});

test("targets: ci( seeks to the next pair when not inside", () => {
  assert.equal(run("foo (bar)", 0, ["c", "i", "("], ON).doc.text, "foo ()");
});
