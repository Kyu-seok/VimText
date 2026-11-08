import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TextareaField } from "../../src/field/TextareaField";
import { Session } from "../../src/bridge/Session";
import { surround } from "../../src/plugins/surround";
import { targets } from "../../src/plugins/targets";
import { Sessions } from "../../src/content/Sessions";
import { keyDriver } from "./keys";
import { keys as keysOn, settle, statusText } from "./dom";
import { controlledPort, settingsFor } from "./settings-port";

/**
 * The bridge's Plugin key hook (DESIGN.md "Plugins", ADR 0006): a typed
 * sequence a Plugin claims becomes one Plugin Key before the engine sees it,
 * a sequence that turns out not to be claimed is released in order, Esc
 * discards what is held. Observed from outside through what the engine did
 * with the keys it received: a vimrc maps the Plugin Keys to Baseline
 * commands whose effect on the Field is visible (`r` makes the character
 * that follows visible, `d`/`x` show the count), so this file proves the
 * grammar and nothing of surround's semantics (tests/unit/surround.test.ts).
 * Coverage (rule 5): Normal, Visual and operator-pending on a textarea, and
 * Replace on a textarea and on a Field inside an open shadow root (a key held
 * there would take a typed character from the Field); Insert never reaches
 * the hook (`nativeInsert` returns first; session.test.ts). Blur is covered
 * on textareas, with the Sessions class routing the focus events.
 */

const TEXT = "the quick brown fox\njumps over the lazy dog\nthird line here";
const VIMRC = "nnoremap <SurroundDs> r\nnnoremap <SurroundYss> r\nvnoremap <SurroundS> d";

let ta: HTMLTextAreaElement;
let field: TextareaField;
let session: Session;
const { keydown, keys } = keyDriver(() => session);

function makeTextarea(text: string, root: ParentNode = document.body): HTMLTextAreaElement {
  const el = document.createElement("textarea");
  el.value = text;
  el.style.cssText = "width:400px;height:120px;font:14px/1.4 monospace";
  root.appendChild(el);
  return el;
}

function activate(vimrc: string, plugins = [surround], text = TEXT, root: ParentNode = document.body): void {
  ta = makeTextarea(text, root);
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

  it("d w feeds d then w: the released d is the operator and w its motion", () => {
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

describe("with surround on, in Replace", () => {
  afterEach(() => document.body.replaceChildren());

  it("d is not held: R then d overwrites the first character and the Status Line shows REPLACE", () => {
    activate(VIMRC);
    keys("Rd");
    expect(ta.value).toMatch(/^dhe quick/);
    expect(statusText()).toContain("REPLACE");
  });

  it("the same on a Field inside an open shadow root", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    activate(VIMRC, [surround], TEXT, host.attachShadow({ mode: "open" }));
    keys("Rd");
    expect(ta.value).toMatch(/^dhe quick/);
    expect(statusText()).toContain("REPLACE");
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

// Focus leaving the Field ends what the hook and the Plugin were waiting for
// (DESIGN.md "Plugins"): the Sessions class routes the focus events, with the
// Site Policy "normal" so a focused textarea Activates at once; the engine
// runs surround's own commands here, so the Field shows what completed.
describe("with surround on, when the Field loses focus", () => {
  let sessions: Sessions;
  let first: HTMLTextAreaElement;
  let second: HTMLTextAreaElement;

  beforeEach(async () => {
    const port = controlledPort();
    sessions = new Sessions(document, port.port, location.origin, null, { surround });
    port.arrive({ ...settingsFor("normal"), plugins: { surround: true, targets: false } });
    await settle();
    first = makeTextarea(TEXT);
    second = makeTextarea("second field");
    // Both Activated up front: an Activation's `mapclear` would otherwise hide what a wait leaves behind.
    second.focus();
    second.setSelectionRange(0, 0);
    first.focus();
    first.setSelectionRange(0, 0);
    // Two Status Line hosts now: the Mode is read as the popup reads it.
    expect(sessions.focusedMode).toBe("normal");
  });

  afterEach(() => {
    sessions.destroy();
    first.remove();
    second.remove();
  });

  it("a held d is discarded: d, Tab away and back, s is the Baseline substitute, not ds", () => {
    keysOn(first, "d");
    second.focus(); // where the page's Tab lands
    first.focus();
    keysOn(first, "s");
    expect(first.value).toMatch(/^he quick/);
    expect(sessions.focusedMode).toBe("insert");
  });

  it("a wait armed in one Field never takes a key typed in another: ysiw, focus the second Field, x deletes there", () => {
    keysOn(first, "ysiw");
    second.focus();
    keysOn(second, "x");
    expect(second.value).toBe("econd field");
    expect(first.value).toBe(TEXT);
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

  it("c i w feeds c i w: the released i and w are the stock text object under c", () => {
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
