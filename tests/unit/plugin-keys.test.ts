import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TextareaField } from "../../src/field/TextareaField";
import { Session } from "../../src/bridge/Session";
import { surround } from "../../src/plugins/surround";
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

function activate(vimrc: string, plugins = [surround]): void {
  ta = document.createElement("textarea");
  ta.value = TEXT;
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
