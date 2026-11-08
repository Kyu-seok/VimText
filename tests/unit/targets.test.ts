import { describe, it, expect, afterEach } from "vitest";
import { targets } from "../../src/plugins/targets";
import { pluginMirror } from "./plugin-mirror";

/**
 * targets' semantics (DESIGN.md "Plugins"; oracle: targets.vim's targets.txt
 * with its default settings, whose examples and charts these cases are),
 * driven at the mirror under spec #24's exception to rule 6
 * (tests/unit/plugin-mirror.ts) and observed through the mirror's document
 * and selection and the Mode text the engine renders.
 */

const { open, close, feed, text, selected, status } = pluginMirror(targets);

afterEach(close);

describe("pair objects Seek (targets.txt 'pair seek'): inside first, then the next on the line, then the last", () => {
  const DOC = "This is example text (with a pair of parentheses)";

  it("ci( from before the pair changes inside the next one", () => {
    open(DOC, 5);
    feed("c", "i", "(");
    expect(text()).toBe("This is example text ()");
    expect(status()).toContain("INSERT");
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
    expect(status()).toContain("INSERT");
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
    expect(status()).toContain("NORMAL");
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
    expect(status()).toContain("INSERT");
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
    expect(status()).toContain("NORMAL");
  });

  it("the back tick is a quote too, and in Visual the string becomes the selection", () => {
    open("x `code` y", 0);
    feed("v", "i", "`");
    expect(selected()).toBe("code");
  });
});

describe("n and l reach the next and last object (targets.txt 'next and last pair', the pair chart)", () => {
  // The chart's line, the cursor on dddddd (targets.txt "pair charts").
  const CHART = "a ( bbbbbbbb ) ( ccccccc ) ( dddddd ) ( eeeeeee ) ( ffffffff ) g";
  const D = 31;

  it("cin( from before the pair changes inside the next one (targets.txt 'cin)' example)", () => {
    open("This is example text (with a pair of parentheses)", 5);
    feed("c", "TargetsIn", "(");
    expect(text()).toBe("This is example text ()");
    expect(status()).toContain("INSERT");
  });

  it("in) from inside a pair is the pair after it; 2in) the one after that", () => {
    open(CHART, D);
    feed("d", "TargetsIn", ")");
    expect(text()).toBe("a ( bbbbbbbb ) ( ccccccc ) ( dddddd ) () ( ffffffff ) g");
    open(CHART, D);
    feed("d", "2", "TargetsIn", ")");
    expect(text()).toBe("a ( bbbbbbbb ) ( ccccccc ) ( dddddd ) ( eeeeeee ) () g");
  });

  it("il) is the pair before; 2il) the one before that; al) takes its brackets", () => {
    open(CHART, D);
    feed("d", "TargetsIl", ")");
    expect(text()).toBe("a ( bbbbbbbb ) () ( dddddd ) ( eeeeeee ) ( ffffffff ) g");
    open(CHART, D);
    feed("d", "2", "TargetsIl", ")");
    expect(text()).toBe("a () ( ccccccc ) ( dddddd ) ( eeeeeee ) ( ffffffff ) g");
    open(CHART, D);
    feed("d", "TargetsAl", ")");
    expect(text()).toBe("a ( bbbbbbbb )  ( dddddd ) ( eeeeeee ) ( ffffffff ) g");
  });

  it("with nested pairs, in) is the next pair opening after the cursor and il) the last one closing before it (the nested chart)", () => {
    // The cursor on ffffff.
    const NESTED = "a ( b ( cccccccc ) d ) ( e ( ffffff ) g ) ( h ( iiiiiiii ) j ) k";
    open(NESTED, 29);
    feed("d", "TargetsIn", ")");
    expect(text()).toBe("a ( b ( cccccccc ) d ) ( e ( ffffff ) g ) () k");
    open(NESTED, 29);
    feed("d", "TargetsIl", ")");
    expect(text()).toBe("a () ( e ( ffffff ) g ) ( h ( iiiiiiii ) j ) k");
    open(NESTED, 29);
    feed("d", "2", "TargetsIl", ")");
    expect(text()).toBe("a ( b () d ) ( e ( ffffff ) g ) ( h ( iiiiiiii ) j ) k");
  });

  it('dil" deletes inside the last string, across a line when the cursor line has none', () => {
    open('"a" "b"\nnone here', 10);
    feed("d", "TargetsIl", '"');
    expect(text()).toBe('"a" ""\nnone here');
  });

  it('in" skips the string the cursor is in', () => {
    open('"a" "b" "c"', 5);
    feed("d", "TargetsIn", '"');
    expect(text()).toBe('"a" "b" ""');
  });

  it("vin( selects inside the next pair", () => {
    open("(a) (b)", 1);
    feed("v", "TargetsIn", "(");
    expect(selected()).toBe("b");
  });

  it("no next object: the operator is cancelled and Normal mode stays", () => {
    open("(a) tail", 5);
    feed("c", "TargetsIn", "(", "x");
    expect(text()).toBe("(a) til");
    expect(status()).toContain("NORMAL");
  });

  it("a key that is no object after in cancels the operator too, as the engine's own failed text object does (DESIGN.md limitations)", () => {
    open("one two", 0);
    feed("c", "TargetsIn", "w", "x");
    expect(text()).toBe("ne two");
    expect(status()).toContain("NORMAL");
  });

  it(". repeats din( on the next pair from where the cursor ended", () => {
    open("(a) (b) (c)", 0);
    feed("d", "TargetsIn", "(", ".");
    expect(text()).toBe("(a) () ()");
  });
});

describe("argument objects (targets.txt 'argument text objects' and its chart)", () => {
  it("ia is the text between the argument's delimiters; aa leaves a proper list behind (targets.txt example)", () => {
    open("a , b ( cccccccc , d ) e", 9);
    feed("d", "i", "a");
    expect(text()).toBe("a , b (, d ) e");
    open("a , b ( cccccccc , d ) e", 9);
    feed("d", "a", "a");
    expect(text()).toBe("a , b ( d ) e");
  });

  it("daa on the first, a middle and the last argument leaves a proper list each time", () => {
    open("f(a, b, c)", 2);
    feed("d", "a", "a");
    expect(text()).toBe("f(b, c)");
    open("f(a, b, c)", 5);
    feed("d", "a", "a");
    expect(text()).toBe("f(a, c)");
    open("f(a, b, c)", 8);
    feed("d", "a", "a");
    expect(text()).toBe("f(a, b)");
  });

  it("cia on the only argument changes it", () => {
    open("f( x )", 3);
    feed("c", "i", "a");
    expect(text()).toBe("f()");
    expect(status()).toContain("INSERT");
  });

  // The argument chart's line, the cursor on eeeeee.
  const CHART = "a ( bbbbbb , ccccccc , d ( eeeeee , fffffff ) , gggggg ) h";
  const E = 28;

  it("ia and aa on a nested argument; 2ia and 2aa on the argument enclosing it", () => {
    open(CHART, E);
    feed("d", "i", "a");
    expect(text()).toBe("a ( bbbbbb , ccccccc , d (, fffffff ) , gggggg ) h");
    open(CHART, E);
    feed("d", "a", "a");
    expect(text()).toBe("a ( bbbbbb , ccccccc , d ( fffffff ) , gggggg ) h");
    open(CHART, E);
    feed("d", "2", "i", "a");
    expect(text()).toBe("a ( bbbbbb , ccccccc ,, gggggg ) h");
    open(CHART, E);
    feed("d", "2", "a", "a");
    expect(text()).toBe("a ( bbbbbb , ccccccc , gggggg ) h");
  });

  it("ina and ana are the argument after; 2ina the one after the enclosing list closes", () => {
    open(CHART, E);
    feed("d", "TargetsIn", "a");
    expect(text()).toBe("a ( bbbbbb , ccccccc , d ( eeeeee ,) , gggggg ) h");
    open(CHART, E);
    feed("d", "TargetsAn", "a");
    expect(text()).toBe("a ( bbbbbb , ccccccc , d ( eeeeee ) , gggggg ) h");
    open(CHART, E);
    feed("d", "2", "TargetsIn", "a");
    expect(text()).toBe("a ( bbbbbb , ccccccc , d ( eeeeee , fffffff ) ,) h");
  });

  it("ila and ala are the argument before; 2ala the one before that", () => {
    open(CHART, E);
    feed("d", "TargetsIl", "a");
    expect(text()).toBe("a ( bbbbbb ,, d ( eeeeee , fffffff ) , gggggg ) h");
    open(CHART, E);
    feed("d", "TargetsAl", "a");
    expect(text()).toBe("a ( bbbbbb , d ( eeeeee , fffffff ) , gggggg ) h");
    open(CHART, E);
    feed("d", "2", "TargetsAl", "a");
    expect(text()).toBe("a ( ccccccc , d ( eeeeee , fffffff ) , gggggg ) h");
  });

  it("ia from outside any brackets Seeks the next argument on the line", () => {
    open("x f(a, b)", 0);
    feed("d", "i", "a");
    expect(text()).toBe("x f(, b)");
  });

  it("a comma outside brackets is no argument: nothing changes", () => {
    open("a, b", 0);
    feed("d", "i", "a", "x");
    expect(text()).toBe(", b");
    expect(status()).toContain("NORMAL");
  });

  it("an argument spanning lines: daa on the last one takes its separator and the line break", () => {
    open("f(\n  a,\n  b\n)", 9);
    feed("d", "a", "a");
    expect(text()).toBe("f(\n  a)");
  });

  it("via selects the argument", () => {
    open("f(a, bb, c)", 5);
    feed("v", "i", "a");
    expect(selected()).toBe(" bb");
  });
});
