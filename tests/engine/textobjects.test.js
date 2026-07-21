import { test } from "node:test";
import assert from "node:assert/strict";
import { textObject } from "../../content-scripts/engine/textobjects.js";

const slice = (text, r) => (r ? text.slice(r.start, r.end) : null);

test("iw / aw word objects", () => {
  const t = "foo bar baz";
  assert.equal(slice(t, textObject(t, 5, "i", "w")), "bar");
  assert.equal(slice(t, textObject(t, 5, "a", "w")), "bar ");
  assert.equal(slice(t, textObject(t, 3, "i", "w")), " "); // on whitespace
});

test("i( / a( with nesting", () => {
  const t = "a(b(c)d)e"; // a0 (1 b2 (3 c4 )5 d6 )7 e8
  assert.equal(slice(t, textObject(t, 4, "i", "(")), "c");
  assert.equal(slice(t, textObject(t, 4, "a", "(")), "(c)");
  assert.equal(slice(t, textObject(t, 2, "i", "(")), "b(c)d");
  assert.equal(slice(t, textObject(t, 2, "a", "(")), "(b(c)d)");
});

test("bracket aliases b / B and other pairs", () => {
  assert.equal(slice("(x)", textObject("(x)", 1, "i", "b")), "x");
  assert.equal(slice("{y}", textObject("{y}", 1, "i", "B")), "y");
  assert.equal(slice("[z]", textObject("[z]", 1, "a", "]")), "[z]");
  assert.equal(slice("<q>", textObject("<q>", 1, "i", "<")), "q");
});

test("i( returns null when not inside and not seeking", () => {
  assert.equal(textObject("abc", 1, "i", "("), null);
});

test('quote objects look forward on the line', () => {
  const t = 'say "hi" now';
  assert.equal(slice(t, textObject(t, 5, "i", '"')), "hi");
  assert.equal(slice(t, textObject(t, 5, "a", '"')), '"hi" '); // includes trailing space
  assert.equal(slice(t, textObject(t, 0, "i", '"')), "hi"); // before the quotes -> seeks
});

test("targets: seek to next pair when not inside", () => {
  const t = "foo (bar) baz";
  assert.equal(slice(t, textObject(t, 0, "i", "(", { seek: true })), "bar");
});

test("targets: in / il next & last for pairs", () => {
  const t = "(a) (b) (c)"; // pairs at 0-2, 4-6, 8-10
  assert.equal(slice(t, textObject(t, 1, "i", "(", { which: "next" })), "b");
  assert.equal(slice(t, textObject(t, 1, "a", "(", { which: "next" })), "(b)");
  assert.equal(slice(t, textObject(t, 5, "i", "(", { which: "last" })), "a");
  assert.equal(slice(t, textObject(t, 1, "i", "(", { which: "next", count: 2 })), "c");
});

test("targets: in / il next & last for quotes", () => {
  const t = '"a" "b" "c"';
  assert.equal(slice(t, textObject(t, 1, "i", '"', { which: "next" })), "b");
  assert.equal(slice(t, textObject(t, 5, "i", '"', { which: "last" })), "a");
});

test("it / at tag objects, innermost wins", () => {
  assert.equal(slice("<b>hi</b>", textObject("<b>hi</b>", 4, "i", "t")), "hi");
  assert.equal(slice("<b>hi</b>", textObject("<b>hi</b>", 4, "a", "t")), "<b>hi</b>");
  const nested = "<p><b>x</b></p>";
  assert.equal(slice(nested, textObject(nested, 6, "i", "t")), "x");
  assert.equal(slice(nested, textObject(nested, 6, "a", "t")), "<b>x</b>");
});
