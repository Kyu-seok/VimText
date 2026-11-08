import { describe, it, expect, afterEach } from "vitest";
import { Mirror } from "../../src/engine/mirror";
import { engineApi } from "../../src/engine/pluginApi";
import { targets } from "../../src/plugins/targets";

/**
 * targets' semantics (DESIGN.md "Plugins"; oracle: targets.vim's targets.txt
 * with its default settings, whose examples and charts these cases are). As
 * tests/unit/surround.test.ts, under the one exception spec #24 grants to rule
 * 6: the Plugin is driven at the mirror, fed its exact object keys and its
 * Plugin Keys directly, so that the hook's grammar
 * (tests/unit/plugin-keys.test.ts) and the Plugin's meaning are proven apart.
 * Observed through the mirror's document and selection, which are what the
 * Session renders into the Field.
 */

let mirror: Mirror | null = null;
let scratch: HTMLElement | null = null;

/** A mirror over `doc` with the cursor at `cursor` and targets bound, as an Activation binds it. */
function open(doc: string, cursor: number): void {
  scratch = document.createElement("div");
  scratch.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden";
  const input = document.createElement("textarea");
  const statusbar = document.createElement("div");
  scratch.append(input, statusbar);
  document.body.appendChild(scratch);
  mirror = new Mirror({
    container: scratch,
    inputField: input,
    focus: () => {},
    doc,
    cursor,
    style: {
      font: "13px monospace",
      letterSpacing: "normal",
      lineHeight: "normal",
      contentWidth: 400,
      whiteSpace: "pre-wrap",
      wordBreak: "normal",
      overflowWrap: "normal",
      tabSize: "8",
    },
    statusbar,
  });
  mirror.clearUserMappings();
  targets.define(engineApi);
  targets.bind(engineApi);
}

afterEach(() => {
  mirror?.clearUserMappings();
  mirror?.destroy();
  scratch?.remove();
  mirror = null;
  scratch = null;
});

/** Feeds keys: a single character as typed, a longer name as a Plugin Key or special key. */
function feed(...keys: string[]): void {
  for (const key of keys) {
    mirror!.handleKey({
      key,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      shiftKey: false,
      preventDefault() {},
      stopPropagation() {},
    });
  }
}

const text = () => mirror!.view.state.doc.toString();
const insertMode = () => mirror!.vim.insertMode;
/** The Visual selection as the text it covers. */
const selected = () => {
  const { from, to } = mirror!.view.state.selection.main;
  return mirror!.view.state.doc.sliceString(from, to);
};

describe("pair objects Seek (targets.txt 'pair seek'): inside first, then the next on the line, then the last", () => {
  const DOC = "This is example text (with a pair of parentheses)";

  it("ci( from before the pair changes inside the next one", () => {
    open(DOC, 5);
    feed("c", "i", "(");
    expect(text()).toBe("This is example text ()");
    expect(insertMode()).toBe(true);
  });

  it("ci( from inside the pair changes inside it", () => {
    open(DOC, 30);
    feed("c", "i", "(");
    expect(text()).toBe("This is example text ()");
  });

  it("ci( from after the pair seeks back to the last one", () => {
    open("(a) and then more", 10);
    feed("c", "i", "(");
    expect(text()).toBe("() and then more");
    expect(insertMode()).toBe(true);
  });

  it("the pair the cursor is in wins over a later one on the line", () => {
    open("(a) (b) (c)", 5);
    feed("d", "i", "(");
    expect(text()).toBe("(a) () (c)");
  });

  it("the next pair wins over the last one", () => {
    open("(a) x (b)", 4);
    feed("d", "i", "(");
    expect(text()).toBe("(a) x ()");
  });

  it("a( takes the brackets too; the aliases b and B stand for ( and {", () => {
    open("x (a) {b} y", 0);
    feed("d", "a", "b");
    expect(text()).toBe("x  {b} y");
    feed("d", "a", "B");
    expect(text()).toBe("x   y");
  });

  it("a pair that spans lines is found from inside it", () => {
    open("f(\n  a,\n  b\n)", 5);
    feed("d", "i", ")");
    expect(text()).toBe("f()");
  });

  it("a pair on the line wins over one spanning lines around the cursor (seek ranges: lr rr ll before lb ar ab)", () => {
    open("{\n  x (a) y\n}", 4);
    feed("d", "i", "B");
    expect(text()).toBe("{}"); // no braces on the line: the enclosing ones
    open("{ x (a) }\n", 2);
    feed("d", "i", "(");
    expect(text()).toBe("{ x () }\n"); // parentheses ahead on the line
  });

  it("the next pair is found on a later line when nothing is around or on the line", () => {
    open("a\nb (c)", 0);
    feed("d", "i", "(");
    expect(text()).toBe("a\nb ()");
  });

  it("no pair anywhere: the operator is cancelled and Normal mode stays", () => {
    open("no pair", 3);
    feed("c", "i", "(", "x");
    expect(text()).toBe("no air");
    expect(insertMode()).toBe(false);
  });

  it("the Plugin's i( shadows the engine's for that key only: iw stays the engine's", () => {
    open("one two", 0);
    feed("d", "i", "w");
    expect(text()).toBe(" two");
  });
});

describe("a count selects the enclosing pairs (targets.txt 'a ( b ( cccccccc ) d ) e')", () => {
  const DOC = "a ( b ( cccccccc ) d ) e";

  it("2i( from inside the inner pair selects inside the outer one", () => {
    open(DOC, 10);
    feed("d", "2", "i", ")");
    expect(text()).toBe("a () e");
  });

  it("2a( selects the outer pair with its brackets", () => {
    open(DOC, 10);
    feed("d", "2", "a", ")");
    expect(text()).toBe("a  e");
  });

  it("a count larger than the nesting fails: nothing changes", () => {
    open(DOC, 10);
    feed("d", "3", "i", ")");
    expect(text()).toBe(DOC);
  });
});

describe("in Visual, the object becomes the selection", () => {
  it("vi( from before the pair selects inside the next one", () => {
    open("x (abc) y", 0);
    feed("v", "i", "(");
    expect(selected()).toBe("abc");
  });

  it("va( selects the pair with its brackets", () => {
    open("x (abc) y", 4);
    feed("v", "a", "(");
    expect(selected()).toBe("(abc)");
  });

  it("i( again grows the selection to the enclosing pair", () => {
    open("((ab) c)", 2);
    feed("v", "i", "(", "i", "(");
    expect(selected()).toBe("(ab) c");
  });

  it("d after vi( deletes what was selected", () => {
    open("x (abc) y", 0);
    feed("v", "i", "(", "d");
    expect(text()).toBe("x () y");
  });
});

describe("quote objects count the quotes from the start of the line (targets.txt 'quote text objects')", () => {
  it("di' inside the quotes, and da' takes the quotes and no surrounding whitespace", () => {
    open("a ' bbbbbbbb ' c ' d ' e", 6);
    feed("d", "i", "'");
    expect(text()).toBe("a '' c ' d ' e");
    open("a ' bbbbbbbb ' c ' d ' e", 6);
    feed("d", "a", "'");
    expect(text()).toBe("a  c ' d ' e");
  });

  it('ci" on the comma between two strings skips the false quotes and changes the next string (targets.txt)', () => {
    open('join("hello", "world")', 12);
    feed("c", "i", '"');
    expect(text()).toBe('join("hello", "")');
    expect(insertMode()).toBe(true);
  });

  it('di" from before any quote on the line changes the next string', () => {
    open('say "a" and "b"', 0);
    feed("d", "i", '"');
    expect(text()).toBe('say "" and "b"');
  });

  it('di" from after the last quote on the line seeks back to the last string', () => {
    open('"a" "b" tail', 10);
    feed("d", "i", '"');
    expect(text()).toBe('"a" "" tail');
  });

  it("on an opening quote the string it opens is the one; on a closing quote the string it closes", () => {
    open('"a" "b"', 4);
    feed("d", "i", '"');
    expect(text()).toBe('"a" ""');
    open('"a" "b"', 2);
    feed("d", "i", '"');
    expect(text()).toBe('"" "b"');
  });

  it("the Seek for a quote stays on the cursor's line: a string on the next line is not found", () => {
    open('none\n"a"', 1);
    feed("d", "i", '"', "x");
    expect(text()).toBe('nne\n"a"');
    expect(insertMode()).toBe(false);
  });

  it("the back tick is a quote too, and in Visual the string becomes the selection", () => {
    open("x `code` y", 0);
    feed("v", "i", "`");
    expect(selected()).toBe("code");
  });
});
