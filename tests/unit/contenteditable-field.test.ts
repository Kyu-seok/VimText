import { describe, it, expect, afterEach } from "vitest";
import { ContentEditableField } from "../../src/field/ContentEditableField";
import {
  blockTexts,
  caretAt,
  editableHost,
  inputLog,
  isCaretIn,
  selectedText,
  typeNatively,
} from "./contenteditable";

/**
 * A contenteditable Field at the `Field` seam (ADR 0007): its text is the
 * host's projection, its selection the native one, and every write step is
 * offered to the page as a synthetic `beforeinput` (ADR 0008) and, where no
 * listener cancels it, run as the browser's own editing command, so the page
 * sees each as a `beforeinput` and an `input` with the same editing
 * `inputType` (Chrome fires no `beforeinput` of its own for `execCommand`;
 * see docs/engine-seams.md "Editing commands").
 */

let field: ContentEditableField | null = null;

afterEach(() => {
  field?.destroy();
  field = null;
  document.body.innerHTML = "";
});

function fieldOn(html: string) {
  const host = editableHost(html);
  host.focus();
  field = new ContentEditableField(host);
  return { host, field };
}

describe("ContentEditableField", () => {
  // A Notion block: marked contenteditable inside the page's editable root,
  // which keeps focus (#69).
  it("a host nested in an editable root has focus while the root does and the caret is in it; blur releases the root", () => {
    const root = editableHost(
      '<div id="a" contenteditable="true">one</div><div id="b" contenteditable="true">two</div>',
    );
    const [a, b] = [document.getElementById("a")!, document.getElementById("b")!];
    const field = new ContentEditableField(b);
    root.focus();
    caretAt(b.firstChild!, 1);
    expect(field.hasFocus()).toBe(true);
    caretAt(a.firstChild!, 1);
    expect(field.hasFocus()).toBe(false);
    caretAt(b.firstChild!, 1);
    field.blur();
    expect(document.activeElement).not.toBe(root);
    field.focus();
    expect(document.activeElement).toBe(root);
    field.destroy();
  });

  it("is a multi-line Field on its host, its text the projection", async () => {
    const { host, field } = fieldOn("<p>one</p><p><br></p><p>three</p>");
    expect(field.element).toBe(host);
    expect(field.singleLine).toBe(false);
    expect(field.getValue()).toBe("one\n\nthree");
  });

  it("selects a character as the native selection and reads it back", async () => {
    const { field } = fieldOn("<p>ab<b>cd</b></p><p>ef</p>");
    field.setSelection(2, 3);
    expect(selectedText()).toBe("c");
    expect(field.getSelection()).toEqual({ anchor: 2, head: 3 });
    field.setSelection(6, 5);
    expect(selectedText()).toBe("e");
    expect(field.getSelection()).toEqual({ anchor: 6, head: 5 });
  });

  it("an empty line's cursor is a collapsed caret in its block", async () => {
    const { host, field } = fieldOn("<p>a</p><p><br></p><p>b</p>");
    field.setSelection(2, 2);
    expect(isCaretIn(host.children[1]!)).toBe(true);
    expect(field.getSelection()).toEqual({ anchor: 2, head: 2 });
  });

  it("reads a caret the user put in a text node", async () => {
    const { host, field } = fieldOn("<p>ab</p><p>cd</p>");
    caretAt(host.children[1]!.firstChild!, 1);
    expect(field.getSelection()).toEqual({ anchor: 4, head: 4 });
  });

  it("deletes through the editing command, leaving the formatting around it", async () => {
    const { host, field } = fieldOn("<p>ab<b>cde</b>f</p>");
    const log = inputLog(host);
    await field.setValue("abcef");
    expect(host.innerHTML).toBe("<p>ab<b>ce</b>f</p>");
    expect(log).toEqual(["before:deleteContentBackward", "input:deleteContentBackward"]);
  });

  it("keeps a space the browser's delete drops at the edge of a block", async () => {
    // Chrome removes the whitespace-only text node `delete` leaves at the start of the block.
    const { host, field } = fieldOn("<p>quick <b>brown</b> fox</p>");
    await field.setValue(" brown fox");
    expect(field.getValue()).toBe(" brown fox");
    expect(host.querySelector("b")!.textContent).toBe("brown");
    await field.setValue("slow brown fox");
    expect(field.getValue()).toBe("slow brown fox");
    expect(host.querySelector("b")!.textContent).toBe("brown"); // the new word is plain text, not bold
  });

  it("a no-break space projects as the space it renders as", async () => {
    const { field } = fieldOn("<p>a&nbsp;b&nbsp;</p>");
    expect(field.getValue()).toBe("a b ");
  });

  it("inserts and replaces through insertText", async () => {
    const { host, field } = fieldOn("<p>ab<b>cd</b></p>");
    const log = inputLog(host);
    await field.setValue("abcXd");
    expect(host.innerHTML).toBe("<p>ab<b>cXd</b></p>");
    await field.setValue("abcYZ");
    expect(field.getValue()).toBe("abcYZ");
    expect(host.querySelector("b")!.textContent).toBe("cYZ");
    expect(log).toEqual(["before:insertText", "input:insertText", "before:insertText", "input:insertText"]);
  });

  it("an inserted newline is a new block, made by insertParagraph", async () => {
    const { host, field } = fieldOn("<p>one</p><p>two</p>");
    const log = inputLog(host);
    await field.setValue("one\n\ntwo");
    expect(blockTexts(host)).toEqual(["one", "", "two"]);
    expect(field.getValue()).toBe("one\n\ntwo");
    await field.setValue("one\nnew\nmore\n\ntwo");
    expect(blockTexts(host)).toEqual(["one", "new", "more", "", "two"]);
    expect(log).toContain("input:insertParagraph");
    expect(log.every((e) => /^(before|input):(insertText|insertParagraph)$/.test(e))).toBe(true);
  });

  // #61: Chromium's insertParagraph at the end of an <h1> makes a <div>, which
  // Quill replaces with a <p> of its own, the caret then wherever its
  // re-render left it. The text after the paragraph break goes at the start of
  // the new line, where the projection puts it, not where that caret is.
  it("text after a paragraph break lands on the new line when the editor re-rendered it and moved the caret", async () => {
    const { host, field } = fieldOn("<p>one</p><h1>head</h1><p>two</p>");
    const heading = host.querySelector("h1")!.firstChild!;
    new MutationObserver(() => {
      for (const div of host.querySelectorAll(":scope > div")) {
        const p = document.createElement("p");
        p.append(document.createElement("br"));
        div.replaceWith(p);
        getSelection()!.setBaseAndExtent(heading, 4, heading, 4);
      }
    }).observe(host, { childList: true });
    await field.setValue("one\nhead\nnew\ntwo");
    expect(blockTexts(host)).toEqual(["one", "head", "new", "two"]);
    expect(host.children[2]!.localName).toBe("p");
  });

  it("a deleted newline merges two blocks", async () => {
    const { host, field } = fieldOn("<p>one</p><p>two</p><p>three</p>");
    await field.setValue("one\nthree");
    expect(blockTexts(host)).toEqual(["one", "three"]);
    await field.setValue("one three");
    expect(blockTexts(host)).toEqual(["one three"]);
  });

  it("tells its handlers about the user's typing, never about its own writes", async () => {
    const { host, field } = fieldOn("<p>ab</p>");
    let calls = 0;
    field.onInput(() => calls++);
    await field.setValue("a");
    expect(calls).toBe(0);
    caretAt(host.firstChild!.firstChild!, 1);
    typeNatively("z");
    expect(calls).toBe(1);
    expect(field.getValue()).toBe("az");
  });

  it("reports focus on its host", async () => {
    const { field } = fieldOn("<p>ab</p>");
    expect(field.hasFocus()).toBe(true);
    field.blur();
    expect(field.hasFocus()).toBe(false);
    field.focus();
    expect(field.hasFocus()).toBe(true);
  });
});
