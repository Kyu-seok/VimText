import { describe, it, expect, afterEach, vi } from "vitest";
import { project } from "../../src/field/projection";
import { resolveField } from "../../src/field/resolve";
import { activeHost, backspaceNatively, editableHost } from "./contenteditable";
import { keyDriver } from "./keys";
import { statusText } from "./dom";
import { Session } from "../../src/bridge/Session";
import { TextareaField } from "../../src/field/TextareaField";

/**
 * Atoms (GLOSSARY.md, DESIGN.md "contenteditable Fields", _Atoms_, #47): a
 * `contenteditable="false"` island or a replaced element inside the host is
 * one U+FFFC to Vim and its visible text in a register.
 */

const OBJ = "\uFFFC";
// prettier-ignore
const ATOMS = '<p>hi <span contenteditable="false">@alice</span> and <img alt="cat"> ok</p><p>next</p>';

let current: ReturnType<typeof activeHost> | null = null;

afterEach(() => {
  current?.destroy();
  current = null;
  document.body.innerHTML = "";
});

const { keydown, keys } = keyDriver(() => current!.session);

function open(html = ATOMS) {
  current = activeHost(html);
  return current;
}

/** Whether the native selection covers `el` and nothing more: the cursor on an Atom. */
function coversExactly(el: Element): boolean {
  const sel = getSelection()!;
  const range = sel.getRangeAt(0);
  const whole = document.createRange();
  whole.selectNode(el);
  return (
    sel.containsNode(el, false) &&
    range.compareBoundaryPoints(Range.START_TO_START, whole) === 0 &&
    range.toString() === whole.toString()
  );
}

describe("Atoms in the projection", () => {
  it("an island and an image are one U+FFFC each, never their inner text", () => {
    expect(project(editableHost(ATOMS)).text).toBe(`hi ${OBJ} and ${OBJ} ok\nnext`);
  });

  it("an Atom's character maps to the DOM positions around its element", () => {
    const host = editableHost(ATOMS);
    const p = project(host);
    const chip = host.querySelector("span")!;
    const i = p.text.indexOf(OBJ);
    expect(p.toDom(i)).toEqual({ node: chip.parentNode, offset: 1 });
    expect(p.fromDom(chip.parentNode!, 1)).toBe(i);
    expect(p.fromDom(chip.parentNode!, 2)).toBe(i + 1);
    expect(p.fromDom(chip.firstChild!, 2)).toBe(i);
  });
});

describe("motions over Atoms", () => {
  it("l and h step over each Atom as one character, and the cursor on it selects the whole Atom", () => {
    const { host } = open();
    const chip = host.querySelector("span")!;
    const img = host.querySelector("img")!;
    keys("lll");
    expect(coversExactly(chip)).toBe(true);
    keys("l");
    expect(getSelection()!.toString()).toBe(" ");
    keys("lllll");
    expect(coversExactly(img)).toBe(true);
    keys("h");
    expect(getSelection()!.toString()).toBe(" ");
  });

  it("w lands on each Atom as a word of its own", () => {
    const { host } = open();
    keys("w");
    expect(coversExactly(host.querySelector("span")!)).toBe(true);
    keys("ww");
    expect(coversExactly(host.querySelector("img")!)).toBe(true);
    keys("w");
    expect(getSelection()!.toString()).toBe("o");
  });
});

describe("editing Atoms", () => {
  it("x on an Atom removes its whole element; u brings the element back", () => {
    const { host, field } = open();
    keys("wx");
    expect(host.querySelector("span")).toBeNull();
    expect(field.getValue()).toBe(`hi  and ${OBJ} ok\nnext`);
    keys("u");
    const chip = host.querySelector("span");
    expect(chip?.getAttribute("contenteditable")).toBe("false");
    expect(chip?.textContent).toBe("@alice");
    expect(field.getValue()).toBe(`hi ${OBJ} and ${OBJ} ok\nnext`);
  });

  it("dw on the image removes it; u brings it back with its alt", () => {
    const { host, field } = open();
    keys("wwwdw");
    expect(host.querySelector("img")).toBeNull();
    expect(field.getValue()).toBe(`hi ${OBJ} and ok\nnext`);
    keys("u");
    expect(host.querySelector("img")?.getAttribute("alt")).toBe("cat");
    expect(field.getValue()).toBe(`hi ${OBJ} and ${OBJ} ok\nnext`);
  });
});

describe("undoing Atom deletions", () => {
  it("an Atom that ends its block comes back inside that block", () => {
    const { host, field } = open('<p>a <span contenteditable="false">@bob</span></p><p>next</p>');
    keys("$x");
    expect(field.getValue()).toBe("a \nnext");
    keys("u");
    expect(field.getValue()).toBe(`a ${OBJ}\nnext`);
    expect(host.children[0]!.querySelector("span")?.textContent).toBe("@bob");
  });

  it("dd of a line with two Atoms, then u, brings both back in order", () => {
    const { host, field } = open();
    keys("dd");
    expect(field.getValue()).toBe("next");
    keys("u");
    expect(field.getValue()).toBe(`hi ${OBJ} and ${OBJ} ok\nnext`);
    expect(host.querySelector("span")?.textContent).toBe("@alice");
    expect(host.querySelector("img")?.getAttribute("alt")).toBe("cat");
  });
});

describe("undo puts back the Atom removed at that place", () => {
  const TWO = '<p>a<img alt="first">b<img alt="second">c</p>';
  const alts = (host: HTMLElement) => [...host.querySelectorAll("img")].map((i) => i.alt);

  it("an Atom Backspaced in Insert mode comes back on u in its own place, and an earlier x's Atom on the next u", () => {
    const { host, field } = open(TWO);
    keys("lx");
    expect(alts(host)).toEqual(["second"]);
    keys("$i");
    backspaceNatively();
    keydown("Escape");
    expect(field.getValue()).toBe("abc");
    keys("u");
    expect(alts(host)).toEqual(["second"]);
    expect(field.getValue()).toBe(`ab${OBJ}c`);
    expect(statusText()).not.toContain("refused");
    keys("u");
    expect(alts(host)).toEqual(["first", "second"]);
    expect(field.getValue()).toBe(`a${OBJ}b${OBJ}c`);
    expect(statusText()).not.toContain("refused");
  });

  it("a U+FFFC written back with no element kept for it is not reported as a refused edit", () => {
    const { field } = open(`<p>a${OBJ}b</p>`);
    keys(`l"_x`); // the black hole: a literal U+FFFC in "- would show in a later test's :reg
    expect(field.getValue()).toBe("ab");
    keys("u");
    expect(statusText()).not.toContain("refused");
    expect(field.getValue()).toBe("ab");
  });
});

describe("Atoms in registers", () => {
  /** Runs an ex command through the command line, as the user does. */
  function exCommand(line: string): void {
    keys(":");
    const input = document.querySelector("vimtext-status")!.shadowRoot!.querySelector("input")!;
    input.value = line;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
  }

  it('yy stores each Atom as its visible text: "0p puts it, :reg shows it, never U+FFFC', () => {
    const { field } = open();
    keys("yyj");
    keys('"0p');
    expect(field.getValue()).toBe(`hi ${OBJ} and ${OBJ} ok\nnext\nhi @alice and cat ok`);
    exCommand("reg");
    expect(statusText()).toContain("hi @alice and cat ok");
    expect(statusText()).not.toContain(OBJ);
  });

  it("x on an Atom stores its visible text", () => {
    const { field } = open();
    keys("wx$p");
    expect(field.getValue()).toBe(`hi  and ${OBJ} ok@alice\nnext`);
  });

  it("a Visual p over an Atom leaves its visible text in the unnamed register", () => {
    const { field } = open();
    keys("yiwwvp$p");
    expect(field.getValue()).toBe(`hi hi and ${OBJ} ok@alice\nnext`);
  });

  it('"+y puts the visible text on the clipboard', () => {
    let clipboard = "";
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: {
        writeText: (text: string) => {
          clipboard = text;
          return Promise.resolve();
        },
        readText: () => Promise.resolve(clipboard),
      },
    });
    try {
      open();
      keys('"+yy');
      expect(clipboard).toBe("hi @alice and cat ok\n");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Atoms in registers with several Fields Activated (registers are page-global)", () => {
  it("the second host's yank stores its own Atoms' text; a textarea's literal U+FFFC stays one", () => {
    const first = open();
    const second = activeHost('<p>to <span contenteditable="false">@bob</span></p>');
    const ta = document.createElement("textarea");
    ta.value = `lit ${OBJ} x`;
    document.body.appendChild(ta);
    const taField = new TextareaField(ta);
    const taSession = new Session(taField, { vimrc: "" });
    const onSecond = keyDriver(() => second.session);
    const onTextarea = keyDriver(() => taSession);
    try {
      second.host.focus();
      onSecond.keys("yyp");
      expect(second.field.getValue()).toBe(`to ${OBJ}\nto @bob`);
      ta.focus();
      ta.setSelectionRange(0, 0);
      onTextarea.keys("yyp");
      expect(ta.value).toBe(`lit ${OBJ} x\nlit ${OBJ} x`);
      first.host.focus();
      keys("yyjp");
      expect(first.field.getValue()).toBe(`hi ${OBJ} and ${OBJ} ok\nnext\nhi @alice and cat ok`);
    } finally {
      taSession.destroy();
      taField.destroy();
      second.destroy();
    }
  });
});

describe("the command line on a contenteditable host", () => {
  it("keeps focus after : (the render's selection does not pull focus back to the host)", () => {
    open();
    keys(":");
    // The command line's input sits in the Status Line's shadow root, so the document sees its host focused.
    expect(document.activeElement?.localName).toBe("vimtext-status");
  });
});

describe("focus inside an Atom", () => {
  it("resolves to the host Field", () => {
    const host = editableHost(ATOMS);
    const chip = host.querySelector("span")!;
    expect(resolveField(chip)?.element).toBe(host);
    expect(resolveField(chip.firstChild)?.element).toBe(host);
  });
});
