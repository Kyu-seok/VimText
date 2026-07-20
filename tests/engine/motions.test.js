import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeMotion, lineStart, lineEnd, firstNonBlank, lineCount, clampCursor,
} from "../../content-scripts/engine/motions.js";

const to = (name, text, pos, count = null, opts = {}) =>
  computeMotion(name, text, pos, count, opts).to;

test("line helpers", () => {
  const t = "abc\ndef\nghi";
  assert.equal(lineStart(t, 5), 4);
  assert.equal(lineEnd(t, 5), 7);
  assert.equal(lineEnd(t, 9), 11);
  assert.equal(lineCount(t), 3);
  assert.equal(firstNonBlank("   hi", 0), 3);
});

test("h / l stay within the line and honor counts", () => {
  const t = "hello world";
  assert.equal(to("l", t, 0, 3), 3);
  assert.equal(to("l", t, 10, 5), 11); // clamps to lineEnd
  assert.equal(to("h", t, 3, 5), 0); // clamps to lineStart
});

test("0 / ^ / $", () => {
  const t = "  hi there";
  assert.equal(to("0", t, 5), 0);
  assert.equal(to("^", t, 5), 2);
  assert.deepEqual(computeMotion("$", t, 0), { to: 9, inclusive: true, linewise: false });
});

test("word motions w / b / e", () => {
  const t = "hello world";
  assert.equal(to("w", t, 0), 6);
  assert.equal(to("b", t, 6), 0);
  assert.deepEqual(computeMotion("e", t, 0), { to: 4, inclusive: true, linewise: false });
});

test("word motions treat punctuation as its own word", () => {
  const t = "foo.bar";
  assert.equal(to("w", t, 0), 3); // 'foo' -> '.'
  assert.equal(to("w", t, 3), 4); // '.' -> 'bar'
});

test("j / k preserve column and clamp to shorter lines", () => {
  const t = "abcd\nef"; // a0 b1 c2 d3 \n4 e5 f6
  assert.equal(to("j", t, 1), 6); // col 1 on line 2 -> 'f'
  // clampCursor keeps the cursor on a real char when the target line is short
  assert.equal(clampCursor(t, to("j", t, 3)), 6);
  assert.equal(to("k", t, 6), 1); // 'f' (col 1) up to 'b' (col 1)
});

test("j / k are linewise for operators", () => {
  const t = "a\nb\nc";
  assert.equal(computeMotion("j", t, 0).linewise, true);
  assert.equal(computeMotion("k", t, 4).linewise, true);
});

test("gg / G / {count}G", () => {
  const t = "l1\nl2\nl3\nl4"; // starts at 0,3,6,9
  assert.equal(to("gg", t, 8), 0);
  assert.equal(to("G", t, 0), 9); // last line
  assert.equal(to("G", t, 0, 2), 3); // 2G
  assert.equal(to("gg", t, 8, 3), 6); // 3gg
});

test("single-line inputs make j / k no-op", () => {
  const t = "hello";
  assert.equal(to("j", t, 2, null, { singleLine: true }), 2);
  assert.equal(to("k", t, 2, null, { singleLine: true }), 2);
});

test("clampCursor keeps Normal cursor off the newline", () => {
  const t = "ab\ncd";
  assert.equal(clampCursor(t, 2), 1); // newline pos -> last char
  assert.equal(clampCursor(t, 2, { allowEol: true }), 2);
});
