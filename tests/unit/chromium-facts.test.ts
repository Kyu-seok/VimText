import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "@vitest/browser/context";
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

describe("Marks at a write's edges", () => {
  const RUNS = "<p>ab<b>cdef</b>gh</p>";

  it("insertText at a boundary between two text nodes takes the style before it, whichever node the caret is in", () => {
    for (const [label, at] of [
      ["start of the bold run", (b: Node) => [b, 0] as const],
      ["end of the plain text before it", (b: Node) => [b.parentNode!.previousSibling!, 2] as const],
    ] as const) {
      const el = host(RUNS);
      const [node, offset] = at(el.querySelector("b")!.firstChild!);
      caretAt(node, offset);
      document.execCommand("insertText", false, "X");
      expect(el.innerHTML, label).toBe("<p>abX<b>cdef</b>gh</p>");
    }
    for (const [label, at] of [
      ["end of the bold run", (b: Node) => [b, 4] as const],
      ["start of the plain text after it", (b: Node) => [b.parentNode!.nextSibling!, 0] as const],
    ] as const) {
      const el = host(RUNS);
      const [node, offset] = at(el.querySelector("b")!.firstChild!);
      caretAt(node, offset);
      document.execCommand("insertText", false, "X");
      expect(el.innerHTML, label).toBe("<p>ab<b>cdefX</b>gh</p>");
    }
  });

  it("text deleted from a run's start leaves no typing style: the next insertText takes the style before it", () => {
    const el = host(RUNS);
    const bold = el.querySelector("b")!.firstChild!;
    select(bold, 0, bold, 2);
    document.execCommand("delete");
    document.execCommand("insertText", false, "X");
    expect(el.innerHTML).toBe("<p>abX<b>ef</b>gh</p>");
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

describe("Leaving a contenteditable Field", () => {
  it("a host keeps its selection when it blurs: a one-character range stays selected (#65)", () => {
    const el = host("<p>hello</p>");
    const text = el.querySelector("p")!.firstChild!;
    select(text, 1, text, 2);
    el.blur();
    expect(document.activeElement).not.toBe(el);
    expect(getSelection()!.toString()).toBe("e");
  });

  it("focus() on a host whose selection is elsewhere puts the caret at its start (#65)", () => {
    const el = host("<p>hello</p>");
    caretAt(el.querySelector("p")!.firstChild!, 3);
    const input = document.createElement("input");
    document.body.appendChild(input);
    cleanup.push(() => input.remove());
    input.focus();
    el.focus();
    const sel = getSelection()!;
    expect(sel.isCollapsed).toBe(true);
    expect(el.contains(sel.anchorNode)).toBe(true);
    expect(sel.anchorOffset).toBe(0);
  });

  it("the focus that setting a selection inside a blurred host gives it fires during the call", () => {
    const el = host("<p>hello</p>");
    el.blur();
    let focused = false;
    el.addEventListener("focus", () => (focused = true));
    caretAt(el.querySelector("p")!.firstChild!, 1);
    expect(focused).toBe(true);
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

  it("a synthetic keydown takes the legacy keyCode and which from its init, as Notion reads them (#70)", () => {
    const key = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      shiftKey: true,
      keyCode: 13,
      which: 13,
    });
    expect(key.keyCode).toBe(13);
    expect(key.which).toBe(13);
  });
});

describe("Enter on a Single-line host", () => {
  it("a trusted Enter over a one-character selection fires a cancelable insertParagraph beforeinput that replaces the selection", async () => {
    const el = host("<p>hello world</p>", { attrs: { "aria-multiline": "false" } });
    const seen: { type: string; trusted: boolean; cancelable: boolean }[] = [];
    el.addEventListener("beforeinput", (e) =>
      seen.push({ type: (e as InputEvent).inputType, trusted: e.isTrusted, cancelable: e.cancelable }),
    );
    const text = el.querySelector("p")!.firstChild!;
    select(text, 6, text, 7);
    await userEvent.keyboard("{Enter}");
    expect(seen).toEqual([{ type: "insertParagraph", trusted: true, cancelable: true }]);
    expect(el.innerHTML).toBe("<p>hello&nbsp;</p><p>orld</p>");
  });

  it("cancelling that beforeinput leaves the host and the selection as they were", async () => {
    const el = host("<p>hello world</p>", { attrs: { "aria-multiline": "false" } });
    el.addEventListener("beforeinput", (e) => e.preventDefault());
    const text = el.querySelector("p")!.firstChild!;
    select(text, 6, text, 7);
    await userEvent.keyboard("{Enter}");
    expect(el.innerHTML).toBe("<p>hello world</p>");
    const sel = getSelection()!;
    expect([sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset]).toEqual([text, 6, text, 7]);
  });
});

describe("Measuring the drawn Cursor", () => {
  it("a selection inside a textarea is no document Range over its text: the document's range is collapsed beside the textarea, though toString reads the selected text", () => {
    const ta = document.createElement("textarea");
    ta.value = "hello";
    document.body.appendChild(ta);
    cleanup.push(() => ta.remove());
    ta.focus();
    ta.setSelectionRange(0, 1);
    const range = getSelection()!.getRangeAt(0);
    expect(range.collapsed).toBe(true);
    expect(range.startContainer).toBe(document.body);
    expect(range.toString()).toBe("");
    expect(getSelection()!.toString()).toBe("h");
  });

  it("a Range over a tab in pre-wrap text has one client rect, the tab's whole advance", () => {
    const el = host("<p>a\tb</p>");
    el.style.whiteSpace = "pre-wrap";
    el.style.font = "14px/20px monospace";
    el.style.tabSize = "4";
    const text = el.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 1);
    const a = range.getClientRects()[0]!.width;
    range.setStart(text, 1);
    range.setEnd(text, 2);
    const rects = [...range.getClientRects()];
    expect(rects.length).toBe(1);
    expect(rects[0]!.width).toBeCloseTo(3 * a, 0);
  });

  it("a Range over a space at a soft wrap has only zero-width rects, one at each line's edge", () => {
    const el = host("<p>aaaa bbbb</p>");
    el.style.width = "40px";
    el.style.font = "14px/20px monospace";
    const text = el.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 4);
    range.setEnd(text, 5);
    const rects = [...range.getClientRects()];
    expect(rects.map((r) => r.width)).toEqual([0, 0]);
    expect(rects[1]!.top).toBeGreaterThan(rects[0]!.top);
    // The letter before it ends the first line where the space's first rect stands.
    range.setStart(text, 3);
    range.setEnd(text, 4);
    expect(range.getClientRects()[0]!.right).toBeCloseTo(rects[0]!.left, 0);
  });

  it("a collapsed Range in an empty block has no client rects; its placeholder <br> has the line's", () => {
    const el = host("<p>x</p><p><br></p>");
    const empty = el.querySelectorAll("p")[1]!;
    const range = document.createRange();
    range.setStart(empty, 0);
    expect(range.getClientRects().length).toBe(0);
    range.selectNode(empty.firstChild!);
    const br = range.getClientRects()[0]!;
    expect(br.height).toBeGreaterThan(0);
    expect(br.top).toBeGreaterThanOrEqual(empty.getBoundingClientRect().top);
  });
});

describe("The caret-hiding stylesheet under editing", () => {
  function adopt(rule: string): void {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(rule);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    cleanup.push(
      () => (document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet)),
    );
  }

  function merge(el: HTMLElement): void {
    const [a, b] = el.querySelectorAll("p");
    select(a!.firstChild!, 3, b!.firstChild!, 0);
    document.execCommand("delete");
  }

  it("without it, a block merge moves the second block's text in bare", () => {
    const el = host("<p>one</p><p>two</p>");
    merge(el);
    expect(el.innerHTML).toBe("<p>onetwo</p>");
  });

  it("with `:focus, :focus *` caret-color adopted, a block merge wraps the moved text in a <span>", () => {
    adopt(":focus, :focus * { caret-color: transparent !important; }");
    const el = host("<p>one</p><p>two</p>");
    merge(el);
    expect(el.innerHTML).toBe("<p>one<span>two</span></p>");
  });

  it("with `:focus` alone, the merge writes the caret-color into the moved text's style", () => {
    adopt(":focus { caret-color: transparent !important; }");
    const el = host("<p>one</p><p>two</p>");
    merge(el);
    expect(el.innerHTML).toBe('<p>one<span style="caret-color: transparent;">two</span></p>');
  });
});

describe("Inverting the drawn Cursor", () => {
  /**
   * A 20 px box fixed over a black glyph-like bar a quarter of its width, inside `host` when given,
   * styled `css`, on a page whose only background is `rootBackground` on the
   * root element; resolves to the mean brightness (0–255) Chromium painted in
   * the box. The test runs in an iframe whose canvas is transparent, the
   * parent page showing through it: `"none"` there stands for a top-level page
   * with no background of its own, painted only by the browser's default
   * canvas colour, which nothing in the page blends with
   * (tests/e2e/drawn-cursor.spec.ts, "on a plain page", shows the same).
   */
  async function painted(
    css: string,
    opts: { host?: string; rootBackground?: string } = {},
  ): Promise<number> {
    document.body.style.background = "none";
    document.documentElement.style.background = opts.rootBackground ?? "none";
    const ink = document.createElement("div");
    ink.style.cssText = "position:fixed;left:205px;top:200px;width:5px;height:20px;background:#000";
    const host = document.createElement("div");
    if (opts.host) host.style.cssText = opts.host;
    const box = document.createElement("div");
    box.style.cssText = `position:fixed;left:200px;top:200px;width:20px;height:20px;z-index:10;${css}`;
    host.append(box);
    document.body.append(ink, host);
    cleanup.push(() => {
      ink.remove();
      host.remove();
      document.body.style.background = "";
      document.documentElement.style.background = "";
    });
    for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
    const base64 = await page.screenshot({ element: box, save: false });
    const img = new Image();
    img.src = `data:image/png;base64,${base64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
    return sum / (data.length / 4);
  }

  /** A quarter of the box is the black glyph: shown as is, the box is mostly white; inverted, mostly black. */
  const asIs = (mean: number) => mean > 170 && mean < 215;
  const inverted = (mean: number) => mean > 40 && mean < 100;
  const DIFFERENCE = "background:#fff;mix-blend-mode:difference";
  const INVERT = "backdrop-filter:invert(1)";

  it("with no style the box shows what is beneath it: a white page around a black glyph", async () => {
    expect(asIs(await painted("", { rootBackground: "#fff" }))).toBe(true);
  });

  it("a white difference box blends with a background the page paints: the white turns black, the glyph white", async () => {
    expect(inverted(await painted(DIFFERENCE, { rootBackground: "#fff" }))).toBe(true);
  });

  it("with no background the page paints, a white difference box has nothing to blend with: white, glyph and all", async () => {
    expect(await painted(DIFFERENCE)).toBeGreaterThan(250);
  });

  it("inside an element with isolation: isolate, as Notion makes every element, a white difference box has nothing to blend with", async () => {
    expect(await painted(DIFFERENCE, { host: "isolation:isolate", rootBackground: "#fff" })).toBeGreaterThan(
      250,
    );
  });

  it("a backdrop-filter: invert(1) box inverts the page's background and the glyph", async () => {
    expect(inverted(await painted(INVERT, { rootBackground: "#fff" }))).toBe(true);
  });
});

describe("A blur the page makes in answer to a key", () => {
  /** The key's `eventPhase` as a document `focusout` listener reads it, and once its dispatch is over. */
  async function phases(press: (el: HTMLElement) => Promise<void> | void) {
    const el = host("<p>one</p>");
    let key: KeyboardEvent | null = null;
    let duringFocusout: number | null = null;
    const onKey = (e: KeyboardEvent) => void (key = e);
    const onFocusout = () => void (duringFocusout = key?.eventPhase ?? null);
    document.addEventListener("keydown", onKey, { capture: true });
    document.addEventListener("focusout", onFocusout);
    cleanup.push(() => {
      document.removeEventListener("keydown", onKey, { capture: true });
      document.removeEventListener("focusout", onFocusout);
    });
    el.addEventListener("keydown", () => el.blur());
    await press(el);
    return {
      duringFocusout,
      after: key!.eventPhase,
      trusted: key!.isTrusted,
      active: document.activeElement,
    };
  }

  it("a focusout fired by a keydown listener's blur() finds that keydown still in dispatch; afterwards its eventPhase is NONE", async () => {
    const seen = await phases(() => userEvent.keyboard("{Escape}"));
    expect(seen).toEqual({
      duringFocusout: Event.AT_TARGET,
      after: Event.NONE,
      trusted: true,
      active: document.body,
    });
  });

  it("the same for a synthetic keydown, as a unit test dispatches one", async () => {
    const seen = await phases((el) => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(seen).toEqual({
      duringFocusout: Event.AT_TARGET,
      after: Event.NONE,
      trusted: false,
      active: document.body,
    });
  });
});
