import { describe, it, expect } from "vitest";
import { diffText, diffTextAtCaret } from "../../src/field/diff";

/** The span of `after` the diff says was put in, and the span of `before` it says went. */
function spans(
  before: string,
  after: string,
  caret: number,
): { inserted: string; deleted: string; at: number } {
  const d = diffTextAtCaret(before, after, caret);
  return { inserted: after.slice(d.start, d.endNew), deleted: before.slice(d.start, d.endOld), at: d.start };
}

describe("diffTextAtCaret: typing ends at the caret", () => {
  it("a line typed above one of the same indent is the line break, the indent and the text, where diffText reads the text first", () => {
    const before = "f() {\n  return 1;\n}";
    const after = "f() {\n  bar(x)\n  return 1;\n}";
    const plain = diffText(before, after);
    expect(after.slice(plain.start, plain.endNew)).toBe("bar(x)\n  ");
    // The caret after the whole line.
    expect(spans(before, after, 14)).toEqual({ inserted: "\n  bar(x)", deleted: "", at: 5 });
    // The caret before a bracket the editor closed: the span ends as near after it as it gets.
    expect(spans(before, after, 13)).toEqual({ inserted: "\n  bar(x)", deleted: "", at: 5 });
  });

  it("a line break typed at a line's end above an empty line is the one before the caret", () => {
    expect(spans("a\n\nb", "a\n\n\nb", 2)).toEqual({ inserted: "\n", deleted: "", at: 1 });
    expect(spans("a\n\nb", "a\n\n\nb", 3)).toEqual({ inserted: "\n", deleted: "", at: 2 });
  });

  it("a character deleted from a run is the one at the caret", () => {
    expect(spans("aaab", "aab", 1)).toEqual({ inserted: "", deleted: "a", at: 1 });
    expect(spans("aaab", "aab", 0)).toEqual({ inserted: "", deleted: "a", at: 0 });
  });

  it("a span with one place is diffText's: text typed between different characters, a replacement", () => {
    for (const [before, after, caret] of [
      ["one two", "one new two", 8],
      ["one two", "one 2", 5],
      ["same", "same", 2],
    ] as const) {
      expect(diffTextAtCaret(before, after, caret)).toEqual(diffText(before, after));
    }
  });

  it("a caret the span cannot reach leaves it diffText's", () => {
    // The caret at the text's start, far before the inserted line; and after it.
    const before = "x\n  a\n  b";
    const after = "x\n  a\n  a\n  b";
    expect(diffTextAtCaret(before, after, 0)).toEqual(diffText(before, after));
    expect(diffTextAtCaret(before, after, after.length)).toEqual(diffText(before, after));
  });
});
