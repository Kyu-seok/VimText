import { describe, it, expect, afterEach, vi } from "vitest";
import { project } from "../../src/field/projection";
import { resolveField } from "../../src/field/resolve";
import { activeHost, backspaceNatively, editableHost, selectedText } from "./contenteditable";
import { settledKeyDriver } from "./keys";
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

const { keydown, keys } = settledKeyDriver(() => current!.session);

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
  it("an island and an image are one U+FFFC each, never their inner text", async () => {
    expect(project(editableHost(ATOMS)).text).toBe(`hi ${OBJ} and ${OBJ} ok\nnext`);
  });

  it("an Atom's character maps to the DOM positions around its element", async () => {
    const host = editableHost(ATOMS);
    const p = project(host);
    const chip = host.querySelector("span")!;
    const i = p.text.indexOf(OBJ);
    expect(p.toDom(i)).toEqual({ node: chip.parentNode, offset: 1 });
    expect(p.fromDom(chip.parentNode!, 1)).toBe(i);
    expect(p.fromDom(chip.parentNode!, 2)).toBe(i + 1);
    expect(p.fromDom(chip.firstChild!, 2)).toBe(i);
  });

  // #60: Quill 2 starts each list item with an empty non-editable
  // `<span class="ql-ui">` that draws the bullet through `::before`. It is no
  // text of the item's, so the projection leaves it out and a line's start is
  // the text after it.
  const LIST = '<ol><li><span class="ql-ui" contenteditable="false"></span>first</li><li>next</li></ol>';

  it("a non-editable element with no text of its own is not an Atom: it projects as nothing", () => {
    expect(project(editableHost(LIST)).text).toBe("first\nnext");
    expect(project(editableHost(LIST)).atoms).toEqual([]);
  });

  it("a line's start after such an element maps into the text after it, and back", () => {
    const host = editableHost(LIST);
    const p = project(host);
    const text = host.querySelector("li")!.lastChild!;
    expect(p.toDom(0)).toEqual({ node: text, offset: 0 });
    for (let k = 0; k <= p.text.length; k++) {
      const { node, offset } = p.toDom(k);
      expect(p.fromDom(node, offset), `offset ${k}`).toBe(k);
    }
    const li = host.querySelector("li")!;
    expect(p.fromDom(li, 0)).toBe(0);
    expect(p.fromDom(li, 1)).toBe(0);
  });

  it("a non-editable element holding an image is still an Atom", () => {
    expect(project(editableHost('<p>a <span contenteditable="false"><img alt="x"></span> b</p>')).text).toBe(
      `a ${OBJ} b`,
    );
  });
});

describe("motions over Atoms", () => {
  it("l and h step over each Atom as one character, and the cursor on it selects the whole Atom", async () => {
    const { host } = open();
    const chip = host.querySelector("span")!;
    const img = host.querySelector("img")!;
    await keys("lll");
    expect(coversExactly(chip)).toBe(true);
    await keys("l");
    expect(selectedText()).toBe(" ");
    await keys("lllll");
    expect(coversExactly(img)).toBe(true);
    await keys("h");
    expect(selectedText()).toBe(" ");
  });

  it("w lands on each Atom as a word of its own", async () => {
    const { host } = open();
    await keys("w");
    expect(coversExactly(host.querySelector("span")!)).toBe(true);
    await keys("ww");
    expect(coversExactly(host.querySelector("img")!)).toBe(true);
    await keys("w");
    expect(selectedText()).toBe("o");
  });
});

describe("editing Atoms", () => {
  it("x on an Atom removes its whole element; u brings the element back", async () => {
    const { host, field } = open();
    await keys("wx");
    expect(host.querySelector("span")).toBeNull();
    expect(field.getValue()).toBe(`hi  and ${OBJ} ok\nnext`);
    await keys("u");
    const chip = host.querySelector("span");
    expect(chip?.getAttribute("contenteditable")).toBe("false");
    expect(chip?.textContent).toBe("@alice");
    expect(field.getValue()).toBe(`hi ${OBJ} and ${OBJ} ok\nnext`);
  });

  it("dw on the image removes it; u brings it back with its alt", async () => {
    const { host, field } = open();
    await keys("wwwdw");
    expect(host.querySelector("img")).toBeNull();
    expect(field.getValue()).toBe(`hi ${OBJ} and ok\nnext`);
    await keys("u");
    expect(host.querySelector("img")?.getAttribute("alt")).toBe("cat");
    expect(field.getValue()).toBe(`hi ${OBJ} and ${OBJ} ok\nnext`);
  });
});

describe("undoing Atom deletions", () => {
  it("an Atom that ends its block comes back inside that block", async () => {
    const { host, field } = open('<p>a <span contenteditable="false">@bob</span></p><p>next</p>');
    await keys("$x");
    expect(field.getValue()).toBe("a \nnext");
    await keys("u");
    expect(field.getValue()).toBe(`a ${OBJ}\nnext`);
    expect(host.children[0]!.querySelector("span")?.textContent).toBe("@bob");
  });

  it("dd of a line with two Atoms, then u, brings both back in order", async () => {
    const { host, field } = open();
    await keys("dd");
    expect(field.getValue()).toBe("next");
    await keys("u");
    expect(field.getValue()).toBe(`hi ${OBJ} and ${OBJ} ok\nnext`);
    expect(host.querySelector("span")?.textContent).toBe("@alice");
    expect(host.querySelector("img")?.getAttribute("alt")).toBe("cat");
  });

  // #62: Lexical cancels a `beforeinput` of `insertFromPaste` and does nothing
  // (it pastes only from a real `paste` event), and a decorator cannot come
  // back through the DOM: `insertHTML` there turned the whole line into the
  // decorator's text. The restore is offered to the page first; a page that
  // takes it over gets no `insertHTML`, so u restores the text without the Atom.
  it("a page that takes over the offered restore gets no insertHTML: u restores the text around the Atom, without it", async () => {
    const { host, field } = open('<p>a cat <span contenteditable="false">@cat</span> here</p><p>next</p>');
    const offered: string[] = [];
    host.addEventListener("beforeinput", (e) => {
      if (e.inputType !== "insertFromPaste") return;
      offered.push(e.dataTransfer?.getData("text/html") ?? "");
      e.preventDefault();
    });
    const commands = vi.spyOn(document, "execCommand");
    await keys("wwx");
    expect(field.getValue()).toBe("a cat  here\nnext");
    await keys("u");
    expect(offered).toEqual(['<span contenteditable="false">@cat</span>']);
    expect(commands.mock.calls.map((c) => c[0])).not.toContain("insertHTML");
    expect(field.getValue()).toBe("a cat  here\nnext");
    expect(host.querySelector("span")).toBeNull();
    expect(statusText()).not.toContain("refused");
    // The mirror follows the Field: the next edit lands on the text there.
    await keys("0x");
    expect(field.getValue()).toBe(" cat  here\nnext");
  });

  it("a page that lets the offered restore through gets the Atom back through insertHTML", async () => {
    const { host, field } = open('<p>a cat <span contenteditable="false">@cat</span> here</p>');
    const offered: string[] = [];
    host.addEventListener("beforeinput", (e) => {
      if (e.inputType === "insertFromPaste") offered.push(e.dataTransfer?.getData("text/html") ?? "");
    });
    await keys("wwx");
    await keys("u");
    expect(offered).toHaveLength(1);
    expect(field.getValue()).toBe(`a cat ${OBJ} here`);
    expect(host.querySelector("span")?.textContent).toBe("@cat");
  });
});

describe("undo puts back the Atom removed at that place", () => {
  const TWO = '<p>a<img alt="first">b<img alt="second">c</p>';
  const alts = (host: HTMLElement) => [...host.querySelectorAll("img")].map((i) => i.alt);

  it("an Atom Backspaced in Insert mode comes back on u in its own place, and an earlier x's Atom on the next u", async () => {
    const { host, field } = open(TWO);
    await keys("lx");
    expect(alts(host)).toEqual(["second"]);
    await keys("$i");
    backspaceNatively();
    await keydown("Escape");
    expect(field.getValue()).toBe("abc");
    await keys("u");
    expect(alts(host)).toEqual(["second"]);
    expect(field.getValue()).toBe(`ab${OBJ}c`);
    expect(statusText()).not.toContain("refused");
    await keys("u");
    expect(alts(host)).toEqual(["first", "second"]);
    expect(field.getValue()).toBe(`a${OBJ}b${OBJ}c`);
    expect(statusText()).not.toContain("refused");
  });

  it("a U+FFFC written back with no element kept for it is not reported as a refused edit", async () => {
    const { field } = open(`<p>a${OBJ}b</p>`);
    await keys(`l"_x`); // the black hole: a literal U+FFFC in "- would show in a later test's :reg
    expect(field.getValue()).toBe("ab");
    await keys("u");
    expect(statusText()).not.toContain("refused");
    expect(field.getValue()).toBe("ab");
  });
});

describe("Atoms in registers", () => {
  /** Runs an ex command through the command line, as the user does. */
  async function exCommand(line: string): Promise<void> {
    await keys(":");
    const input = document.querySelector("vimtext-status")!.shadowRoot!.querySelector("input")!;
    input.value = line;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
  }

  it('yy stores each Atom as its visible text: "0p puts it, :reg shows it, never U+FFFC', async () => {
    const { field } = open();
    await keys("yyj");
    await keys('"0p');
    expect(field.getValue()).toBe(`hi ${OBJ} and ${OBJ} ok\nnext\nhi @alice and cat ok`);
    await exCommand("reg");
    expect(statusText()).toContain("hi @alice and cat ok");
    expect(statusText()).not.toContain(OBJ);
  });

  it("x on an Atom stores its visible text", async () => {
    const { field } = open();
    await keys("wx$p");
    expect(field.getValue()).toBe(`hi  and ${OBJ} ok@alice\nnext`);
  });

  it("a Visual p over an Atom leaves its visible text in the unnamed register", async () => {
    const { field } = open();
    await keys("yiwwvp$p");
    expect(field.getValue()).toBe(`hi hi and ${OBJ} ok@alice\nnext`);
  });

  it('"+y puts the visible text on the clipboard', async () => {
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
      await keys('"+yy');
      expect(clipboard).toBe("hi @alice and cat ok\n");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Atoms in registers with several Fields Activated (registers are page-global)", () => {
  it("the second host's yank stores its own Atoms' text; a textarea's literal U+FFFC stays one", async () => {
    const first = open();
    const second = activeHost('<p>to <span contenteditable="false">@bob</span></p>');
    const ta = document.createElement("textarea");
    ta.value = `lit ${OBJ} x`;
    document.body.appendChild(ta);
    const taField = new TextareaField(ta);
    const taSession = new Session(taField, { vimrc: "" });
    const onSecond = settledKeyDriver(() => second.session);
    const onTextarea = settledKeyDriver(() => taSession);
    try {
      second.host.focus();
      await onSecond.keys("yyp");
      expect(second.field.getValue()).toBe(`to ${OBJ}\nto @bob`);
      ta.focus();
      ta.setSelectionRange(0, 0);
      await onTextarea.keys("yyp");
      expect(ta.value).toBe(`lit ${OBJ} x\nlit ${OBJ} x`);
      first.host.focus();
      await keys("yyjp");
      expect(first.field.getValue()).toBe(`hi ${OBJ} and ${OBJ} ok\nnext\nhi @alice and cat ok`);
    } finally {
      taSession.destroy();
      taField.destroy();
      second.destroy();
    }
  });
});

describe("the command line on a contenteditable host", () => {
  it("keeps focus after : (the render's selection does not pull focus back to the host)", async () => {
    open();
    await keys(":");
    // The command line's input sits in the Status Line's shadow root, so the document sees its host focused.
    expect(document.activeElement?.localName).toBe("vimtext-status");
  });
});

describe("focus inside an Atom", () => {
  it("resolves to the host Field", async () => {
    const host = editableHost(ATOMS);
    const chip = host.querySelector("span")!;
    expect(resolveField(chip)?.element).toBe(host);
    expect(resolveField(chip.firstChild)?.element).toBe(host);
  });
});
