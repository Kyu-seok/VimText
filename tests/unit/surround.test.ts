import { describe, it, expect, afterEach } from "vitest";
import { Mirror } from "../../src/engine/mirror";
import { engineApi } from "../../src/engine/pluginApi";
import { surround } from "../../src/plugins/surround";

/**
 * surround's semantics (DESIGN.md "Plugins"; oracle: vim-surround's
 * surround.txt, whose examples these cases are). Spec #24 sanctions one
 * exception to rule 6 here: the Plugin is driven at the mirror, fed its Plugin
 * Keys directly, so that the hook's grammar (tests/unit/plugin-keys.test.ts)
 * and the Plugin's meaning are proven apart. Observed through the mirror's
 * document and cursor, which are what the Session renders into the Field.
 */

let mirror: Mirror | null = null;
let scratch: HTMLElement | null = null;

/** A mirror over `doc` with the cursor at `cursor` and surround bound, as an Activation binds it. */
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
  surround.define(engineApi);
  surround.bind(engineApi);
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
const cursor = () => mirror!.view.state.selection.main.head;

describe("ys{motion}{char} wraps the motion's text", () => {
  it("ysiw) wraps the word in parentheses and leaves the cursor on the opening one", () => {
    open("Hello world!", 7);
    feed("SurroundYs", "i", "w", ")");
    expect(text()).toBe("Hello (world)!");
    expect(cursor()).toBe(6);
  });

  it("ysiw( adds a space inside each parenthesis", () => {
    open("Hello world!", 7);
    feed("SurroundYs", "i", "w", "(");
    expect(text()).toBe("Hello ( world )!");
  });

  it("ys$* wraps to the end of the line with the character itself", () => {
    open("pick up the phone", 12);
    feed("SurroundYs", "$", "*");
    expect(text()).toBe("pick up the *phone*");
  });

  it("the aliases b B r a stand for ) } ] >", () => {
    open("a b c d", 0);
    // W, not w: after a wrap the cursor sits on the new bracket, a word of its own.
    feed("SurroundYs", "i", "w", "b", "W", "SurroundYs", "i", "w", "B");
    feed("W", "SurroundYs", "i", "w", "r", "W", "SurroundYs", "i", "w", "a");
    expect(text()).toBe("(a) {b} [c] <d>");
  });

  it("trailing whitespace inside the motion stays outside the wrap", () => {
    open("foo   bar", 0);
    feed("SurroundYs", "w", '"'); // w covers "foo   "; the spaces are put back after the wrap
    expect(text()).toBe('"foo"   bar');
  });

  it("a linewise motion puts the delimiters on their own lines, indented like the first", () => {
    open("  foo\n  bar\nbaz", 0);
    feed("SurroundYs", "j", "}");
    expect(text()).toBe("  {\n  foo\n  bar\n  }\nbaz");
  });

  it("a cancelled wait (Esc) changes nothing and the next key is a plain key again", () => {
    open("Hello world!", 7);
    feed("SurroundYs", "i", "w", "Escape", ")");
    expect(text()).toBe("Hello world!");
    feed("x"); // ) was the sentence motion, to the end of the text
    expect(text()).toBe("Hello world");
  });

  it("a non-printable key cancels the wait as Esc does", () => {
    open("Hello world!", 7);
    feed("SurroundYs", "i", "w", "ArrowLeft", ")");
    expect(text()).toBe("Hello world!");
  });
});

describe("yss{char} wraps the line, ignoring leading whitespace", () => {
  it('yss" on an indented line', () => {
    open("    Hello world!", 10);
    feed("SurroundYss", '"');
    expect(text()).toBe('    "Hello world!"');
  });

  it("yssB on an indented line (surround.txt)", () => {
    open("    Hello world!", 10);
    feed("SurroundYss", "B");
    expect(text()).toBe("    {Hello world!}");
  });
});

describe("cs{old}{new} changes the surroundings", () => {
  it(`cs"' on "Hello world!"`, () => {
    open('"Hello world!"', 7);
    feed("SurroundCs", '"', "'");
    expect(text()).toBe("'Hello world!'");
    expect(cursor()).toBe(0);
  });

  it("cs)( on (123+456)/2 adds the inner spaces", () => {
    open("(123+456)/2", 5);
    feed("SurroundCs", ")", "(");
    expect(text()).toBe("( 123+456 )/2");
  });

  it("cs)] on (123+456)/2", () => {
    open("(123+456)/2", 5);
    feed("SurroundCs", ")", "]");
    expect(text()).toBe("[123+456]/2");
  });

  it("the opening target trims the inner whitespace: cs(] on ( 123 )", () => {
    open("( 123 )", 3);
    feed("SurroundCs", "(", "]");
    expect(text()).toBe("[123]");
  });

  it("a target with no pair around the cursor changes nothing", () => {
    open("no pair here", 3);
    feed("SurroundCs", "(", "]");
    expect(text()).toBe("no pair here");
  });
});

describe("ds{old} deletes the surroundings", () => {
  it("ds( on (123+456)/2", () => {
    open("(123+456)/2", 5);
    feed("SurroundDs", "(");
    expect(text()).toBe("123+456/2");
    expect(cursor()).toBe(0);
  });

  it(`ds" on "Hello world!" (surround.txt)`, () => {
    open('say "Hello world!" now', 9);
    feed("SurroundDs", '"');
    expect(text()).toBe("say Hello world! now");
  });

  it("ds] on [123+456]/2 (surround.txt)", () => {
    open("[123+456]/2", 5);
    feed("SurroundDs", "]");
    expect(text()).toBe("123+456/2");
  });

  it("ds( trims the inner whitespace, ds) keeps it", () => {
    open("( 123 )", 3);
    feed("SurroundDs", "(");
    expect(text()).toBe("123");
    open("( 123 )", 3);
    feed("SurroundDs", ")");
    expect(text()).toBe(" 123 ");
  });

  it("a count reaches the n-th enclosing pair: 2ds(", () => {
    open("((a))", 2);
    feed("2", "SurroundDs", "(");
    expect(text()).toBe("(a)");
  });

  it("on the opening bracket itself the pair is that bracket's", () => {
    open("(a) (b)", 4);
    feed("SurroundDs", "(");
    expect(text()).toBe("(a) b");
  });

  it("a quote is found on the current line only, and from before it as Vim's i\" does", () => {
    open('x "a"\n"b"', 0);
    feed("SurroundDs", '"');
    expect(text()).toBe('x a\n"b"');
  });

  it("a target with no pair around the cursor changes nothing and leaves Normal mode intact", () => {
    open("no pair", 3);
    feed("SurroundDs", "(", "x");
    expect(text()).toBe("no air");
  });
});

describe("Visual S{char} wraps the selection", () => {
  it("viwS] wraps the selected word", () => {
    open("Hello world!", 7);
    feed("v", "i", "w", "SurroundS", "]");
    expect(text()).toBe("Hello [world]!");
    expect(cursor()).toBe(6);
  });

  it("charwise Visual keeps the selected trailing whitespace inside", () => {
    open("foo bar", 0);
    feed("v", "3", "l", "SurroundS", '"');
    expect(text()).toBe('"foo "bar');
  });

  it("linewise Visual S) puts the parentheses on their own lines", () => {
    open("foo\nbar\nbaz", 4);
    feed("V", "SurroundS", ")");
    expect(text()).toBe("foo\n(\nbar\n)\nbaz");
  });

  it("linewise Visual over two indented lines indents the delimiters like the first", () => {
    open("  foo\n  bar", 0);
    feed("V", "j", "SurroundS", "}");
    expect(text()).toBe("  {\n  foo\n  bar\n  }");
  });
});

describe(". repeats with the same characters", () => {
  it(". after ysiw) wraps the word under the cursor", () => {
    open("one two", 0);
    feed("SurroundYs", "i", "w", ")", "W", ".");
    expect(text()).toBe("(one) (two)");
  });

  it(`. after cs"' changes the next pair the same way`, () => {
    open('"a" "b"', 1);
    feed("SurroundCs", '"', "'", "f", '"', ".");
    expect(text()).toBe("'a' 'b'");
  });

  it(". after Visual S] changes nothing: vim-surround does not repeat Visual S (DESIGN.md limitation)", () => {
    open("one two", 0);
    feed("v", "i", "w", "SurroundS", "]", "W", ".");
    expect(text()).toBe("[one] two");
  });

  it(". after ds( deletes the next pair", () => {
    open("(a) (b)", 1);
    feed("SurroundDs", "(", "f", "(", ".");
    expect(text()).toBe("a b");
  });
});

describe("macros record Plugin Keys and replay through the engine", () => {
  it("a recorded ds( replays with @q", () => {
    open("(a) (b)", 1);
    feed("q", "q", "SurroundDs", "(", "q", "f", "(", "@", "q");
    expect(text()).toBe("a b");
  });

  it("a recorded ysiw) replays, waiting for the character inside the macro", () => {
    open("one two", 0);
    feed("q", "q", "SurroundYs", "i", "w", ")", "q", "W", "@", "q");
    expect(text()).toBe("(one) (two)");
  });
});
