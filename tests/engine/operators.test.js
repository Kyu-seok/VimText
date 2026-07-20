import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMotion } from "../../content-scripts/engine/motions.js";
import {
  rangeFromMotion, deleteText, changeText, yankText, deleteChar,
  deleteLines, changeLines, yankLines, paste,
} from "../../content-scripts/engine/operators.js";

test("rangeFromMotion applies the inclusive rule for e / $", () => {
  const t = "hello world";
  const e = computeMotion("e", t, 0); // to:4 inclusive
  assert.deepEqual(rangeFromMotion(t, 0, e), { start: 0, end: 5 });
  const w = computeMotion("w", t, 0); // to:6 exclusive
  assert.deepEqual(rangeFromMotion(t, 0, w), { start: 0, end: 6 });
});

test("d$ never eats the trailing newline", () => {
  const t = "abc\ndef";
  const dollar = computeMotion("$", t, 0); // to:2 inclusive
  const r = rangeFromMotion(t, 0, dollar);
  const out = deleteText(t, r.start, r.end);
  assert.equal(out.text, "\ndef");
});

test("deleteText / changeText / yankText", () => {
  const t = "hello";
  assert.deepEqual(
    { text: deleteText(t, 0, 2).text, cursor: deleteText(t, 0, 2).cursor },
    { text: "llo", cursor: 0 }
  );
  const c = changeText(t, 0, 2);
  assert.equal(c.text, "llo");
  assert.equal(c.enterInsert, true);
  const y = yankText(t, 0, 2);
  assert.deepEqual(y.register, { text: "he", linewise: false });
});

test("x deletes under cursor without crossing the newline", () => {
  assert.equal(deleteChar("hello", 0, 1).text, "ello");
  assert.equal(deleteChar("hello", 0, 2).text, "llo");
  assert.equal(deleteChar("ab\ncd", 1, 5).text, "a\ncd"); // count clamps to line end
  assert.deepEqual(deleteChar("hi", 0, 1).register, { text: "h", linewise: false });
});

test("deleteLines on the first line", () => {
  const out = deleteLines("abc\ndef\nghi", 0, 0);
  assert.equal(out.text, "def\nghi");
  assert.equal(out.cursor, 0);
  assert.deepEqual(out.register, { text: "abc\n", linewise: true });
});

test("deleteLines on the last line removes the preceding newline", () => {
  const out = deleteLines("abc\ndef\nghi", 8, 8);
  assert.equal(out.text, "abc\ndef");
  assert.equal(out.cursor, 4);
  assert.deepEqual(out.register, { text: "ghi\n", linewise: true });
});

test("deleteLines across a range (dj-style)", () => {
  const out = deleteLines("abc\ndef\nghi", 0, 4); // lines 1-2
  assert.equal(out.text, "ghi");
});

test("changeLines keeps an empty line and enters insert", () => {
  const out = changeLines("abc\ndef", 0, 0);
  assert.equal(out.text, "\ndef");
  assert.equal(out.cursor, 0);
  assert.equal(out.enterInsert, true);
  assert.deepEqual(out.register, { text: "abc\n", linewise: true });
});

test("yankLines produces a linewise register", () => {
  const out = yankLines("abc\ndef", 0, 0);
  assert.deepEqual(out.register, { text: "abc\n", linewise: true });
});

test("linewise paste after / before", () => {
  const reg = { text: "xyz\n", linewise: true };
  assert.equal(paste("abc\ndef", 0, reg, false).text, "abc\nxyz\ndef");
  assert.equal(paste("abc\ndef", 0, reg, true).text, "xyz\nabc\ndef");
});

test("linewise paste after the final line adds a newline", () => {
  const reg = { text: "xyz\n", linewise: true };
  assert.equal(paste("abc", 0, reg, false).text, "abc\nxyz");
});

test("charwise paste puts cursor on the last pasted char", () => {
  const reg = { text: "XY", linewise: false };
  const p = paste("hello", 0, reg, false);
  assert.equal(p.text, "hXYello");
  assert.equal(p.cursor, 2);
  const P = paste("hello", 0, reg, true);
  assert.equal(P.text, "XYhello");
  assert.equal(P.cursor, 1);
});
