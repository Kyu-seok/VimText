import { describe, it, expect, afterEach } from "vitest";
import { ContentEditableField } from "../../src/field/ContentEditableField";
import { blockTexts, caretAt, editableHost, inputLog, selectedText, typeNatively } from "./contenteditable";

/**
 * A contenteditable Field at the `Field` seam (ADR 0007): its text is the
 * host's projection, its selection the native one, and every write is the
 * browser's own editing command, so the page sees each as an `input` with an
 * editing `inputType` (Chrome fires no `beforeinput` for `execCommand`; see
 * docs/engine-seams.md "Editing commands").
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
  it("is a multi-line Field on its host, its text the projection", () => {
    const { host, field } = fieldOn("<p>one</p><p><br></p><p>three</p>");
    expect(field.element).toBe(host);
    expect(field.singleLine).toBe(false);
    expect(field.getValue()).toBe("one\n\nthree");
  });

  it("selects a character as the native selection and reads it back", () => {
    const { field } = fieldOn("<p>ab<b>cd</b></p><p>ef</p>");
    field.setSelection(2, 3);
    expect(selectedText()).toBe("c");
    expect(field.getSelection()).toEqual({ anchor: 2, head: 3 });
    field.setSelection(6, 5);
    expect(selectedText()).toBe("e");
    expect(field.getSelection()).toEqual({ anchor: 6, head: 5 });
  });

  it("an empty line's cursor is a collapsed caret in its block", () => {
    const { host, field } = fieldOn("<p>a</p><p><br></p><p>b</p>");
    field.setSelection(2, 2);
    const sel = getSelection()!;
    expect(sel.isCollapsed).toBe(true);
    expect(host.children[1]!.contains(sel.anchorNode)).toBe(true);
    expect(field.getSelection()).toEqual({ anchor: 2, head: 2 });
  });

  it("reads a caret the user put in a text node", () => {
    const { host, field } = fieldOn("<p>ab</p><p>cd</p>");
    caretAt(host.children[1]!.firstChild!, 1);
    expect(field.getSelection()).toEqual({ anchor: 4, head: 4 });
  });

  it("deletes through the editing command, leaving the formatting around it", () => {
    const { host, field } = fieldOn("<p>ab<b>cde</b>f</p>");
    const log = inputLog(host);
    field.setValue("abcef");
    expect(host.innerHTML).toBe("<p>ab<b>ce</b>f</p>");
    expect(log).toEqual(["input:deleteContentBackward"]);
  });

  it("keeps a space the browser's delete drops at the edge of a block", () => {
    // Chrome removes the whitespace-only text node `delete` leaves at the start of the block.
    const { host, field } = fieldOn("<p>quick <b>brown</b> fox</p>");
    field.setValue(" brown fox");
    expect(field.getValue()).toBe(" brown fox");
    expect(host.querySelector("b")!.textContent).toBe("brown");
    field.setValue("slow brown fox");
    expect(field.getValue()).toBe("slow brown fox");
    expect(host.querySelector("b")!.textContent).toBe("brown"); // the new word is plain text, not bold
  });

  it("a no-break space projects as the space it renders as", () => {
    const { field } = fieldOn("<p>a&nbsp;b&nbsp;</p>");
    expect(field.getValue()).toBe("a b ");
  });

  it("inserts and replaces through insertText", () => {
    const { host, field } = fieldOn("<p>ab<b>cd</b></p>");
    const log = inputLog(host);
    field.setValue("abcXd");
    expect(host.innerHTML).toBe("<p>ab<b>cXd</b></p>");
    field.setValue("abcYZ");
    expect(field.getValue()).toBe("abcYZ");
    expect(host.querySelector("b")!.textContent).toBe("cYZ");
    expect(log).toEqual(["input:insertText", "input:insertText"]);
  });

  it("an inserted newline is a new block, made by insertParagraph", () => {
    const { host, field } = fieldOn("<p>one</p><p>two</p>");
    const log = inputLog(host);
    field.setValue("one\n\ntwo");
    expect(blockTexts(host)).toEqual(["one", "", "two"]);
    expect(field.getValue()).toBe("one\n\ntwo");
    field.setValue("one\nnew\nmore\n\ntwo");
    expect(blockTexts(host)).toEqual(["one", "new", "more", "", "two"]);
    expect(log).toContain("input:insertParagraph");
    expect(log.every((e) => /^input:(insertText|insertParagraph)$/.test(e))).toBe(true);
  });

  it("a deleted newline merges two blocks", () => {
    const { host, field } = fieldOn("<p>one</p><p>two</p><p>three</p>");
    field.setValue("one\nthree");
    expect(blockTexts(host)).toEqual(["one", "three"]);
    field.setValue("one three");
    expect(blockTexts(host)).toEqual(["one three"]);
  });

  it("tells its handlers about the user's typing, never about its own writes", () => {
    const { host, field } = fieldOn("<p>ab</p>");
    let calls = 0;
    field.onInput(() => calls++);
    field.setValue("a");
    expect(calls).toBe(0);
    caretAt(host.firstChild!.firstChild!, 1);
    typeNatively("z");
    expect(calls).toBe(1);
    expect(field.getValue()).toBe("az");
  });

  it("reports focus on its host", () => {
    const { field } = fieldOn("<p>ab</p>");
    expect(field.hasFocus()).toBe(true);
    field.blur();
    expect(field.hasFocus()).toBe(false);
    field.focus();
    expect(field.hasFocus()).toBe(true);
  });
});
