import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TextareaField } from "../../src/field/TextareaField";
import { Session } from "../../src/bridge/Session";

let ta: HTMLTextAreaElement;
let field: TextareaField;
let session: Session;

function keydown(key: string, init: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true, ...init });
  session.handleKeydown(e);
  return e;
}

function keys(seq: string): void {
  for (const ch of seq) keydown(ch);
}

/** Simulates the browser's native Insert-mode typing: value change + input event. */
function typeNatively(text: string): void {
  const { selectionStart, selectionEnd, value } = ta;
  const s = selectionStart ?? 0, e = selectionEnd ?? s;
  ta.value = value.slice(0, s) + text + value.slice(e);
  ta.setSelectionRange(s + text.length, s + text.length);
  ta.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
}

function selected(): string {
  return ta.value.slice(ta.selectionStart!, ta.selectionEnd!);
}

beforeEach(() => {
  ta = document.createElement("textarea");
  ta.value = "the quick brown fox\njumps over the lazy dog\nthird line here";
  ta.style.cssText = "width:400px;height:120px;font:14px/1.4 monospace";
  document.body.appendChild(ta);
  ta.focus();
  ta.setSelectionRange(0, 0);
  field = new TextareaField(ta);
  session = new Session(field, { vimrc: "" });
});

afterEach(() => {
  session.destroy();
  field.destroy();
  ta.remove();
});

describe("Normal mode editing", () => {
  it("starts in Normal with a block cursor on the first char", () => {
    expect(session.mode).toBe("normal");
    expect(selected()).toBe("t");
  });

  it("dw deletes a word and x deletes a char; u undoes", () => {
    keys("dw");
    expect(ta.value).toMatch(/^quick brown/);
    keys("x");
    expect(ta.value).toMatch(/^uick brown/);
    keys("u");
    expect(ta.value).toMatch(/^quick brown/);
  });

  it("consumes keys it handles and swallows unknown printable keys", () => {
    expect(keydown("j").defaultPrevented).toBe(true);
    expect(keydown("\\").defaultPrevented).toBe(true);
    expect(keydown("Tab").defaultPrevented).toBe(false);
    expect(keydown("c", { metaKey: true }).defaultPrevented).toBe(false);
  });

  it("lets a second Esc through to the page", () => {
    expect(keydown("Escape").defaultPrevented).toBe(false);
    keys("d");
    expect(keydown("Escape").defaultPrevented).toBe(true); // cancels pending operator
  });
});

describe("Insert mode", () => {
  it("is native: typing is not intercepted, Esc returns to Normal one char back", () => {
    keys("A");
    expect(session.mode).toBe("insert");
    expect(keydown("z").defaultPrevented).toBe(false);
    typeNatively("!!");
    expect(ta.value).toMatch(/^the quick brown fox!!\n/);
    keydown("Escape");
    expect(session.mode).toBe("normal");
    expect(selected()).toBe("!");
    expect(ta.selectionStart).toBe("the quick brown fox!".length);
  });

  it("records typed text for dot-repeat and as one undo step", () => {
    keys("cw");
    typeNatively("slow");
    keydown("Escape");
    expect(ta.value).toMatch(/^slow quick/);
    keys("w.");
    expect(ta.value).toMatch(/^slow slow brown/);
    keys("u");
    expect(ta.value).toMatch(/^slow quick brown/);
    keys("u");
    expect(ta.value).toMatch(/^the quick brown/);
  });

  it("Ctrl-w and Ctrl-u are Vim keys even in Insert mode", () => {
    keys("A");
    typeNatively(" extra");
    keydown("w", { ctrlKey: true });
    expect(ta.value).toMatch(/^the quick brown fox \n/);
    keydown("u", { ctrlKey: true });
    expect(ta.value).toMatch(/^\njumps/);
  });
});

describe("Field is the truth", () => {
  it("heals from a programmatic value change before the next key", () => {
    ta.value = "replaced by the page"; // the browser moves the caret to the end
    keys("x");
    expect(ta.value).toBe("replaced by the pag");
    keys("0x");
    expect(ta.value).toBe("eplaced by the pag");
  });

  it("follows a mouse click in Normal mode", () => {
    ta.setSelectionRange(4, 4);
    keys("x");
    expect(ta.value).toMatch(/^the uick/);
  });

  it("enters Visual mode from a mouse drag", () => {
    ta.setSelectionRange(0, 9);
    keys("d");
    expect(ta.value).toMatch(/^ brown fox/);
  });
});

describe("Visual mode and text objects", () => {
  it("vee selects two words; d deletes them", () => {
    keys("vee");
    expect(session.mode).toBe("visual");
    expect(selected()).toBe("the quick");
    keys("d");
    expect(ta.value).toMatch(/^ brown fox/);
  });

  it("ciw changes the inner word", () => {
    ta.setSelectionRange(5, 5);
    keys("ciw");
    typeNatively("fast");
    keydown("Escape");
    expect(ta.value).toMatch(/^the fast brown/);
  });
});
