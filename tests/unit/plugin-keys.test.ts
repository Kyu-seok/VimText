import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TextareaField } from "../../src/field/TextareaField";
import { Session } from "../../src/bridge/Session";
import { surround } from "../../src/plugins/surround";
import { targets } from "../../src/plugins/targets";
import { keyDriver } from "./keys";
import { statusText } from "./dom";

/**
 * The bridge's Plugin key hook (DESIGN.md "Plugins", ADR 0006): a typed
 * sequence a Plugin claims becomes one Plugin Key before the engine sees it,
 * a sequence that turns out not to be claimed is released in order, Esc
 * discards what is held. Observed from outside through what the engine did
 * with the keys it received: a vimrc maps the Plugin Keys to Baseline
 * commands whose effect on the Field is visible (`r` makes the character
 * that follows visible, `d`/`x` show the count), so this file proves the
 * grammar and nothing of surround's semantics (tests/unit/surround.test.ts).
 * Coverage (rule 5): Normal, Visual and operator-pending on a textarea; the
 * hook sits inside the Session, so Field placement is the Sessions class's
 * concern.
 */

const TEXT = "the quick brown fox\njumps over the lazy dog\nthird line here";
const VIMRC = "nnoremap <SurroundDs> r\nnnoremap <SurroundYss> r\nvnoremap <SurroundS> d";

let ta: HTMLTextAreaElement;
let field: TextareaField;
let session: Session;
const { keydown, keys } = keyDriver(() => session);

function activate(vimrc: string, plugins = [surround], text = TEXT): void {
  ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "width:400px;height:120px;font:14px/1.4 monospace";
  document.body.appendChild(ta);
  ta.focus();
  ta.setSelectionRange(0, 0);
  field = new TextareaField(ta);
  session = new Session(field, { vimrc, plugins });
}

afterEach(() => {
  session.destroy();
  field.destroy();
  ta.remove();
});

describe("with surround on, in Normal", () => {
  beforeEach(() => activate(VIMRC));

  it("d s ( feeds <SurroundDs> then (", () => {
    keys("ds(");
    expect(ta.value).toMatch(/^\(he quick/);
  });

  it("d w feeds d then w: holding d for s costs nothing", () => {
    keys("dw");
    expect(ta.value).toMatch(/^quick brown/);
  });

  it("d Esc feeds Esc only, and Esc is prevented", () => {
    keys("d");
    expect(keydown("Escape").defaultPrevented).toBe(true);
    keys("w"); // d was discarded, so w is the motion, not the end of dw
    expect(ta.value).toBe(TEXT);
    expect(ta.selectionStart).toBe(4);
  });

  it("a count before the sequence survives: 2 d s (", () => {
    keys("2ds(");
    expect(ta.value).toMatch(/^\(\(e quick/);
  });

  it('a register before the sequence survives: "a d s (', () => {
    keys('"ads(');
    expect(ta.value).toMatch(/^\(he quick/);
  });

  it("y s s ) feeds <SurroundYss> then )", () => {
    keys("yss)");
    expect(ta.value).toMatch(/^\)he quick/);
  });

  it("the Status Line shows the typed keys while a Plugin Key is pending, never its name", () => {
    keys("ds"); // the vimrc's r is now waiting for its character
    expect(statusText()).toContain("ds");
    expect(statusText()).not.toContain("Surround");
  });

  it("y s then another key feeds <SurroundYs> then that key; the Status Line shows ysi while the motion is pending", () => {
    keys("ysi");
    expect(statusText()).toContain("ysi");
    expect(statusText()).not.toContain("Surround");
  });

  it("a Pass-through key (Tab) leaves the wait for the character armed", () => {
    keys("ysiw");
    expect(keydown("Tab").defaultPrevented).toBe(false);
    keys(")");
    expect(ta.value).toMatch(/^\(the\) quick/);
  });

  it("with an operator pending, d is not held: > d s ( is the Baseline", () => {
    keys(">ds(");
    expect(ta.value).toMatch(/^he quick/); // >d clears, s substitutes the t
    expect(session.mode).toBe("insert");
  });
});

describe("with surround on, in Visual", () => {
  beforeEach(() => activate(VIMRC));

  it("S is rewritten to <SurroundS> at once", () => {
    keys("vlS");
    expect(ta.value).toMatch(/^e quick/);
  });

  it("d is not held: v l d s deletes the selection, then s substitutes", () => {
    keys("vlds");
    expect(ta.value).toMatch(/^ quick/);
    expect(session.mode).toBe("insert");
  });
});

describe("with surround off", () => {
  beforeEach(() => activate(VIMRC, []));

  it("nothing is held: d s x is the Baseline (d s clears, x deletes a character)", () => {
    keys("dsx");
    expect(ta.value).toMatch(/^he quick/);
  });
});

// targets' grammar: `i`/`a` are held in operator-pending and Visual only, and
// `n`/`l` completes them into the next/last Plugin Key. The vimrc maps those
// keys to the Baseline `a` (operator-pending `onoremap`, Visual `vnoremap`),
// so a fed Plugin Key shows as the stock `a<object>` text object; a sequence
// released instead shows as the stock `i<object>`.
const PAIRS = 'foo (bar) "baz" qux';
const TARGETS_VIMRC = "onoremap <TargetsIn> a\nvnoremap <TargetsIl> a";

describe("with targets on, in operator-pending", () => {
  beforeEach(() => activate(TARGETS_VIMRC, [targets], PAIRS));

  it("c i n ( feeds c then <TargetsIn> then (", () => {
    keys("cin("); // the engine ran ca( (its a( from before a pair finds the next one)
    expect(ta.value).toBe('foo  "baz" qux');
    expect(session.mode).toBe("insert");
  });

  it("c i w feeds c i w: holding i for n or l costs nothing", () => {
    keys("ciw");
    expect(ta.value).toBe(' (bar) "baz" qux');
    expect(session.mode).toBe("insert");
  });

  it("c i Esc discards i, and Esc cancels the operator", () => {
    keys("ci");
    expect(keydown("Escape").defaultPrevented).toBe(true);
    keys("w"); // nothing pending: w is a motion
    expect(ta.value).toBe(PAIRS);
    expect(ta.selectionStart).toBe(4);
    expect(session.mode).toBe("normal");
  });

  it("a key that completes a pending partial key is not held: d f a deletes through the a at once", () => {
    keys("dfa");
    expect(ta.value).toBe('r) "baz" qux');
  });

  it("the Status Line shows c i n while the object key is pending, never the Plugin Key's name", () => {
    keys("cin");
    expect(statusText()).toContain("cin");
    expect(statusText()).not.toContain("Targets");
  });

  it("with surround on as well, c is released into the engine and i is held in operator-pending: c i n (", () => {
    session.destroy();
    field.destroy();
    ta.remove();
    activate(TARGETS_VIMRC, [surround, targets], PAIRS);
    keys("cin(");
    expect(ta.value).toBe('foo  "baz" qux');
    expect(session.mode).toBe("insert");
  });
});

describe("with targets on, in Visual", () => {
  beforeEach(() => activate(TARGETS_VIMRC, [targets], PAIRS));

  it('v i l " feeds v then <TargetsIl> then "', () => {
    keys('vil"d'); // the engine ran va" (its a" from before the quotes finds the next ones)
    expect(ta.value).toBe("foo (bar)  qux");
  });

  it("v i w feeds v i w", () => {
    keys("viwd");
    expect(ta.value).toBe(' (bar) "baz" qux');
  });
});

describe("with targets on, in Normal with no operator", () => {
  beforeEach(() => activate(TARGETS_VIMRC, [targets], PAIRS));

  it("i is not held: it enters Insert mode at once and the next key is the page's", () => {
    keys("i");
    expect(session.mode).toBe("insert");
    expect(keydown("n").defaultPrevented).toBe(false);
  });
});

describe("with targets off", () => {
  beforeEach(() => activate(TARGETS_VIMRC, [], PAIRS));

  it("nothing is held: c i n ( is the Baseline (i n is no text object, so c is cancelled; ( is a motion)", () => {
    keys("cin(");
    expect(ta.value).toBe(PAIRS);
    expect(session.mode).toBe("normal");
  });
});
