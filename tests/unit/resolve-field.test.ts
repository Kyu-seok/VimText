import { describe, it, expect, afterEach } from "vitest";
import { resolveField } from "../../src/field/resolve";
import { editableHost } from "./contenteditable";

/**
 * The one decision of what is a Field (#42): every entry point of the content
 * entry asks `resolveField`, so these cases are the qualifying rules in one
 * place. A resolved Field is created and observed through the `Field`
 * interface only: its element and whether it is a Single-line Field.
 */

afterEach(() => {
  document.body.innerHTML = "";
});

function add<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  setup: (el: HTMLElementTagNameMap[K]) => void = () => {},
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  setup(el);
  document.body.appendChild(el);
  return el;
}

describe("resolveField", () => {
  it("a textarea is a multi-line Field on itself", () => {
    const ta = add("textarea");
    const resolved = resolveField(ta);
    expect(resolved?.element).toBe(ta);
    const field = resolved!.create();
    expect(field.element).toBe(ta);
    expect(field.singleLine).toBe(false);
    field.destroy();
  });

  it.each(["text", "search", "url", "email", "tel"])("an input of type %s is a Single-line Field", (type) => {
    const input = add("input", (el) => (el.type = type));
    const field = resolveField(input)!.create();
    expect(field.element).toBe(input);
    expect(field.singleLine).toBe(true);
    field.destroy();
  });

  it.each(["password", "number", "checkbox", "date"])("an input of type %s is not a Field", (type) => {
    expect(resolveField(add("input", (el) => (el.type = type)))).toBeNull();
  });

  it("a readonly or disabled text control is not a Field", () => {
    expect(resolveField(add("textarea", (el) => (el.readOnly = true)))).toBeNull();
    expect(resolveField(add("textarea", (el) => (el.disabled = true)))).toBeNull();
    expect(resolveField(add("input", (el) => (el.readOnly = true)))).toBeNull();
    expect(resolveField(add("input", (el) => (el.disabled = true)))).toBeNull();
  });

  it("a text control stops resolving once it stops qualifying", () => {
    const input = add("input");
    expect(resolveField(input)).not.toBeNull();
    input.type = "password";
    expect(resolveField(input)).toBeNull();
  });

  it("other elements, the document and null are not Fields", () => {
    expect(resolveField(add("div"))).toBeNull();
    expect(resolveField(add("button"))).toBeNull();
    expect(resolveField(document)).toBeNull();
    expect(resolveField(null)).toBeNull();
  });
});

describe("resolveField on contenteditable", () => {
  it.each(["true", "plaintext-only"])(
    'a contenteditable="%s" host is a multi-line Field on itself',
    (value) => {
      const host = editableHost("<p>one</p>", { contenteditable: value });
      const resolved = resolveField(host);
      expect(resolved?.element).toBe(host);
      const field = resolved!.create();
      expect(field.element).toBe(host);
      expect(field.singleLine).toBe(false);
      expect(field.getValue()).toBe("one");
      field.destroy();
    },
  );

  it("anything inside a host resolves to the host, a non-editable island and nested editables included", () => {
    const host = editableHost(
      '<p id="p"><b id="b">one</b><span id="island" contenteditable="false"><i id="deep">x</i></span>' +
        '<span id="inner" contenteditable="true">y</span></p>',
    );
    for (const id of ["p", "b", "island", "deep", "inner"]) {
      expect(resolveField(document.getElementById(id))?.element, id).toBe(host);
    }
    expect(resolveField(document.getElementById("b")!.firstChild)?.element).toBe(host);
  });

  it('a contenteditable="false" element outside any host is not a Field', () => {
    expect(resolveField(add("div", (el) => (el.contentEditable = "false")))).toBeNull();
  });

  it("a host stops resolving once it stops being editable", () => {
    const host = editableHost("<p>one</p>");
    expect(resolveField(host)).not.toBeNull();
    host.setAttribute("contenteditable", "false");
    expect(resolveField(host)).toBeNull();
  });
});
