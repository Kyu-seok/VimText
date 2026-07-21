import { test } from "node:test";
import assert from "node:assert/strict";
import { addSurround, changeSurround, deleteSurround } from "../../content-scripts/engine/surround.js";

test("addSurround: closing bracket = no space, opening = spaces", () => {
  assert.equal(addSurround("foo", 0, 3, ")").text, "(foo)");
  assert.equal(addSurround("foo", 0, 3, "(").text, "( foo )");
  assert.equal(addSurround("foo", 0, 3, "]").text, "[foo]");
  assert.equal(addSurround("foo", 0, 3, "{").text, "{ foo }");
  assert.equal(addSurround("foo", 0, 3, '"').text, '"foo"');
});

test("changeSurround: dst spacing follows the named char", () => {
  assert.equal(changeSurround("(foo)", 2, ")", "]").text, "[foo]");
  assert.equal(changeSurround("(foo)", 2, ")", "[").text, "[ foo ]");
  assert.equal(changeSurround('"hi"', 1, '"', "'").text, "'hi'");
});

test("changeSurround: from a tag", () => {
  assert.equal(changeSurround("<b>hi</b>", 4, "t", '"').text, '"hi"');
});

test("deleteSurround: opening char trims inner spaces, closing keeps them", () => {
  assert.equal(deleteSurround("(foo)", 2, ")").text, "foo");
  assert.equal(deleteSurround("( foo )", 3, "(").text, "foo");
  assert.equal(deleteSurround("( foo )", 3, ")").text, " foo ");
});

test("deleteSurround: quotes and tags", () => {
  assert.equal(deleteSurround('a "b" c', 3, '"').text, "a b c");
  assert.equal(deleteSurround("<b>hi</b>", 4, "t").text, "hi");
});

test("returns null for unsupported destination", () => {
  assert.equal(addSurround("foo", 0, 3, "z"), null);
  assert.equal(changeSurround("(foo)", 2, ")", "z"), null);
});
