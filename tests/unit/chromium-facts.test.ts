import { afterEach, describe, expect, it } from "vitest";
import { caretAt, editableHost, inputLog, selectionOf } from "./contenteditable";

/**
 * How Chromium behaves, pinned. Each `describe` is named after the
 * `docs/engine-seams.md` entry that states the fact, and each `it` is one
 * sentence of it, observed on a bare page with no VimText code running. When
 * Chrome changes, the gate goes red here, before the bridge built on the
 * fact misbehaves somewhere less obvious. A doc that states a browser fact
 * names the test that pins it (CODING_STANDARDS rule 12): the M4 spec and
 * ADR 0007 said editing commands fire `beforeinput`, and nothing checked it.
 */

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
  getSelection()!.removeAllRanges();
  (document.activeElement as HTMLElement | null)?.blur();
});

/** A focused host from `html`, removed after the test. */
function host(html: string, opts: Parameters<typeof editableHost>[1] = {}): HTMLElement {
  const el = editableHost(html, opts);
  cleanup.push(() => el.remove());
  el.focus();
  return el;
}

function select(a: Node, ao: number, b: Node, bo: number): void {
  getSelection()!.setBaseAndExtent(a, ao, b, bo);
}

describe("Editing commands and events", () => {
  it("an editing command fires input with its inputType and no beforeinput", () => {
    const el = host("<p>hello</p>");
    const log = inputLog(el);
    caretAt(el.querySelector("p")!.firstChild!, 5);
    document.execCommand("insertText", false, "!");
    select(el.querySelector("p")!.firstChild!, 0, el.querySelector("p")!.firstChild!, 1);
    document.execCommand("delete");
    document.execCommand("insertParagraph");
    expect(log).toEqual(["input:insertText", "input:deleteContentBackward", "input:insertParagraph"]);
  });

  it("so a page that cancels beforeinput does not stop the command", () => {
    const el = host("<p>hello</p>");
    el.addEventListener("beforeinput", (e) => e.preventDefault());
    const text = el.querySelector("p")!.firstChild!;
    select(text, 0, text, 1);
    expect(document.execCommand("delete")).toBe(true);
    expect(el.textContent).toBe("ello");
  });
});

describe("Block merges and splits", () => {
  it("insertParagraph at a block's end makes an empty sibling of the same tag with a placeholder <br>, caret at its start", () => {
    const el = host("<p>one</p>");
    caretAt(el.querySelector("p")!.firstChild!, 3);
    document.execCommand("insertParagraph");
    expect(el.innerHTML).toBe("<p>one</p><p><br></p>");
    const sel = getSelection()!;
    expect([sel.anchorNode, sel.anchorOffset]).toEqual([el.children[1], 0]);
  });

  it("insertParagraph at a heading's end makes a <div>, not another heading", () => {
    const el = host("<h1>head</h1>");
    caretAt(el.querySelector("h1")!.firstChild!, 4);
    document.execCommand("insertParagraph");
    expect(el.innerHTML).toBe("<h1>head</h1><div><br></div>");
  });

  it("insertParagraph at the end of a bare text line above a <div> nests the new line in front of that <div> (#67)", () => {
    const el = host("one<div>two</div>");
    caretAt(el.firstChild!, 3);
    document.execCommand("insertParagraph");
    expect(el.innerHTML).toBe("one<div><br><div>two</div></div>");
  });

  it("deleting from one block's start to the next's moves the next block's first line into the first block's element", () => {
    const el = host("<p>one</p><div>third<br>fourth</div>");
    select(el.querySelector("p")!.firstChild!, 0, el.querySelector("div")!.firstChild!, 0);
    document.execCommand("delete");
    expect(el.innerHTML).toBe("<p>third</p><div>fourth</div>");
  });
});

describe("Whitespace under editing", () => {
  it("a delete that leaves a whitespace-only text node at a block's edge removes it", () => {
    const el = host("<p>quick <b>brown</b></p>");
    const text = el.querySelector("p")!.firstChild!;
    select(text, 0, text, 5);
    document.execCommand("delete");
    expect(el.querySelector("p")!.textContent).toBe("brown");
  });

  it("insertText at a block's start joins the inline that follows", () => {
    const el = host("<p><b>brown</b></p>");
    caretAt(el.querySelector("b")!.firstChild!, 0);
    document.execCommand("insertText", false, "slow ");
    expect(el.querySelector("b")!.textContent).toMatch(/^slow.brown$/);
  });

  it("insertText writes U+00A0 where a plain space would collapse", () => {
    const el = host("<p>end</p>");
    caretAt(el.querySelector("p")!.firstChild!, 3);
    document.execCommand("insertText", false, " ");
    expect(el.querySelector("p")!.textContent).toBe("end ");
  });
});

describe("Selection round trip", () => {
  it("a set selection reads back as given, element positions included", () => {
    const el = host("<p>ab</p><p>cd</p>");
    const p = el.querySelector("p")!;
    select(p, 1, el.children[1]!.firstChild!, 1);
    const sel = getSelection()!;
    expect([sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset]).toEqual([
      p,
      1,
      el.children[1]!.firstChild,
      1,
    ]);
  });
});

describe("innerText as the oracle", () => {
  it("<p> neighbours read with a blank line between them", () => {
    expect(host("<p>a</p><p>b</p>").innerText).toBe("a\n\nb");
  });

  it("a heading gets no blank line of its own: between <div>s it reads one line, beside <p>s the <p>s' blank lines", () => {
    expect(host("<div>a</div><h1>b</h1><div>c</div>").innerText).toBe("a\nb\nc");
    expect(host("<p>a</p><h1>b</h1><p>c</p>").innerText).toBe("a\n\nb\n\nc");
  });

  it("a <br> before a nested block reads as a line more than renders: alone on its line one empty line, ending text none (#67)", () => {
    const topOf = (html: string, last: string) => {
      const el = host(html);
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let text: Node | null;
      while ((text = walker.nextNode()) && text.textContent !== last);
      const range = document.createRange();
      range.selectNodeContents(text!);
      const top = range.getClientRects()[0]!.top - el.getBoundingClientRect().top;
      el.remove();
      return top;
    };
    expect(topOf("one<div><br><div>two</div></div>", "two")).toBe(
      topOf("one<div>x</div><div>two</div>", "two"),
    );
    expect(topOf("<div>a<br><div>b</div></div>", "b")).toBe(topOf("<div>a</div><div>b</div>", "b"));
    expect(host("one<div><br><div>two</div></div>").innerText).toBe("one\n\n\ntwo");
    expect(host("<div>a<br><div>b</div></div>").innerText).toBe("a\n\nb");
  });

  it("a break that ends its block reads as a trailing newline", () => {
    expect(host("<div>a<br></div>").innerText).toBe("a\n");
  });
});

describe("Zero-width no-break space", () => {
  it("innerText reads a U+FEFF as a character, beside text and before an empty block's <br>", () => {
    expect(host("<div>a﻿b</div>").innerText).toBe("a﻿b");
    expect(host("<div>﻿<br></div>").innerText).toBe("﻿\n");
  });
  it("a block holding only a U+FEFF and no <br> renders a line, while an empty block renders none (#68)", () => {
    const el = host("<div>a</div><div>﻿</div><div></div>");
    const [text, zw, empty] = [...el.children].map((c) => c.getBoundingClientRect().height);
    expect(zw).toBeGreaterThan(0);
    expect(zw).toBe(text);
    expect(empty).toBe(0);
  });
});

describe("Whitespace in the offset map", () => {
  it("Chrome exposes the white-space-collapse longhand", () => {
    const el = host("<p>a</p><pre>b</pre>");
    const collapse = (e: Element) => getComputedStyle(e).getPropertyValue("white-space-collapse");
    expect(collapse(el.querySelector("p")!)).toBe("collapse");
    expect(collapse(el.querySelector("pre")!)).toBe("preserve");
  });

  it("Selection.toString reports a collapsed run of source spaces as one space", () => {
    const el = host("<p>one   two</p>");
    const text = el.querySelector("p")!.firstChild!;
    select(text, 0, text, 9);
    expect(getSelection()!.toString()).toBe("one two");
  });
});

describe("plaintext-only hosts", () => {
  it("is content-editable and computes white-space: pre-wrap", () => {
    const el = host("<p>a</p>", { contenteditable: "plaintext-only" });
    expect(el.isContentEditable).toBe(true);
    expect(getComputedStyle(el).whiteSpace).toBe("pre-wrap");
  });
});

describe("Refused edits", () => {
  it("a command whose selection sits inside a contenteditable=false island returns false and changes nothing", () => {
    const el = host('<p>a <span contenteditable="false">@alice</span> b</p>');
    const before = el.innerHTML;
    const chip = el.querySelector("span")!.firstChild!;
    select(chip, 1, chip, 2);
    expect(document.execCommand("delete")).toBe(false);
    expect(el.innerHTML).toBe(before);
  });
});

describe("Selection in an open shadow root", () => {
  it("a selection made inside the tree reads, through the document, as a point beside the shadow host; the shadow root's own reads it inside the tree", () => {
    const component = document.createElement("div");
    document.body.appendChild(component);
    cleanup.push(() => component.remove());
    const root = component.attachShadow({ mode: "open" });
    const el = editableHost("<p>hello</p>", { parent: root });
    el.focus();
    const text = el.querySelector("p")!.firstChild!;
    selectionOf(root).setBaseAndExtent(text, 2, text, 2);
    const index = [...document.body.childNodes].indexOf(component);
    expect([getSelection()!.anchorNode, getSelection()!.anchorOffset]).toEqual([document.body, index]);
    expect([selectionOf(root).anchorNode, selectionOf(root).anchorOffset]).toEqual([text, 2]);
  });

  it("a selection set through the document's setBaseAndExtent reads back as given", () => {
    const component = document.createElement("div");
    document.body.appendChild(component);
    cleanup.push(() => component.remove());
    const el = editableHost("<p>hello</p>", { parent: component.attachShadow({ mode: "open" }) });
    el.focus();
    const text = el.querySelector("p")!.firstChild!;
    caretAt(text, 2);
    expect([getSelection()!.anchorNode, getSelection()!.anchorOffset]).toEqual([text, 2]);
  });
});

describe("Atoms under editing", () => {
  it("a selection from just before to just after an island deletes the whole element", () => {
    const el = host('<p>a <span contenteditable="false">@alice</span> b</p>');
    const p = el.querySelector("p")!;
    select(p, 1, p, 2);
    document.execCommand("delete");
    expect(el.querySelector("span")).toBeNull();
  });

  it("insertHTML of an island at a block's end puts it after the block", () => {
    const el = host("<p>a </p>");
    caretAt(el.querySelector("p")!.firstChild!, 2);
    document.execCommand("insertHTML", false, '<span contenteditable="false">@alice</span>');
    expect(el.querySelector("p")!.querySelector("span")).toBeNull();
    expect(el.querySelector(":scope > span")).not.toBeNull();
  });
});

describe("Selection and focus", () => {
  /** An editable root holding a block itself marked editable, as Notion's page holds its blocks (#69). */
  function nested(): { root: HTMLElement; block: HTMLElement } {
    const root = host('<div>title</div><div id="block" contenteditable="true">body</div>');
    return { root, block: root.querySelector<HTMLElement>("#block")! };
  }

  it("a nested editable is never focused itself: focus() on it does nothing, the root focused or not", () => {
    const { root, block } = nested();
    block.focus();
    expect(document.activeElement).toBe(root);
    root.blur();
    block.focus();
    expect(document.activeElement).toBe(document.body);
    expect(block.matches(":focus")).toBe(false);
  });

  it("an editable root keeps focus while the caret is in a nested editable", () => {
    const { root, block } = nested();
    caretAt(block.firstChild!, 2);
    expect(document.activeElement).toBe(root);
    expect(root.matches(":focus")).toBe(true);
    expect(getSelection()!.anchorNode).toBe(block.firstChild);
  });

  it("setting a selection inside a blurred host focuses it", () => {
    const el = host("<p>hello</p>");
    el.blur();
    caretAt(el.querySelector("p")!.firstChild!, 1);
    expect(document.activeElement).toBe(el);
  });

  it("setSelectionRange on a blurred textarea leaves it blurred", () => {
    const ta = document.createElement("textarea");
    ta.value = "hello";
    document.body.appendChild(ta);
    cleanup.push(() => ta.remove());
    ta.setSelectionRange(1, 1);
    expect(document.activeElement).not.toBe(ta);
  });
});

describe("A line break offered as Shift+Enter", () => {
  /** A focused block holding `text` under `white-space: break-spaces`, as a Notion block is. */
  function breakSpaces(text: string): HTMLElement {
    const el = host(text);
    el.style.whiteSpace = "break-spaces";
    el.style.minHeight = "0";
    return el;
  }

  it("a lone \\n ending the block renders no line: the block is as tall as without it", () => {
    const el = breakSpaces("one\ntwo");
    const height = el.getBoundingClientRect().height;
    el.textContent = "one\ntwo\n";
    expect(el.getBoundingClientRect().height).toBe(height);
    el.textContent = "one\ntwo\n\n";
    expect(el.getBoundingClientRect().height).toBeGreaterThan(height);
  });

  it("Chromium's own line break at the block's end writes two \\n, the caret between them", () => {
    const el = breakSpaces("one\ntwo");
    caretAt(el.firstChild!, 7);
    document.execCommand("insertLineBreak");
    expect(el.innerHTML).toBe("one\ntwo\n\n");
    const beforeCaret = document.createRange();
    beforeCaret.setStart(el, 0);
    beforeCaret.setEnd(getSelection()!.anchorNode!, getSelection()!.anchorOffset);
    expect(beforeCaret.toString()).toBe("one\ntwo\n");
  });

  it("a synthetic Shift+Enter keydown on the block changes nothing by itself", () => {
    const el = breakSpaces("one\ntwo");
    caretAt(el.firstChild!, 3);
    const key = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(key);
    expect(el.innerHTML).toBe("one\ntwo");
  });
});
