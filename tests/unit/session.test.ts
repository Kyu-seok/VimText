import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TextareaField } from "../../src/field/TextareaField";
import { Session } from "../../src/bridge/Session";
import { keyDriver } from "./keys";

let ta: HTMLTextAreaElement;
let field: TextareaField;
let session: Session;

const { keydown, keys } = keyDriver(() => session);

/** Simulates the browser's native Insert-mode typing: value change + input event. */
function typeNatively(text: string): void {
  const { selectionStart, selectionEnd, value } = ta;
  const s = selectionStart ?? 0,
    e = selectionEnd ?? s;
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

  it("swallows the browser's undo and redo shortcuts so the engine keeps one history", () => {
    keys("x");
    expect(keydown("z", { metaKey: true }).defaultPrevented).toBe(true);
    expect(keydown("z", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(keydown("z", { metaKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(keydown("y", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(ta.value).toMatch(/^he quick/);
  });

  it("lets a second Esc through to the page", () => {
    expect(keydown("Escape").defaultPrevented).toBe(false);
    keys("d");
    expect(keydown("Escape").defaultPrevented).toBe(true); // cancels pending operator
  });
});

describe("Activation with the caret at a line's end (#99)", () => {
  /** A fresh Session on the textarea, as Activation makes one, the caret at `at`. */
  function activateAt(at: number): void {
    session.destroy();
    ta.setSelectionRange(at, at);
    session = new Session(field, { vimrc: "" });
  }

  it("puts the Cursor on the text's last character", () => {
    activateAt(ta.value.length);
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([58, 59]);
  });

  it("leaves a selection held at Activation as it was given: the Cursor goes to its head, unclipped", () => {
    // Out of #99's scope, kept as it was: only a caret is clipped.
    session.destroy();
    ta.setSelectionRange(15, 19); // "fox", to the first line's end
    session = new Session(field, { vimrc: "" });
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([19, 19]);
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

  it("Ctrl-r {register} pastes the register", () => {
    keys("yiwA");
    keydown("r", { ctrlKey: true });
    expect(keydown('"').defaultPrevented).toBe(true);
    expect(ta.value).toMatch(/^the quick brown foxthe\n/);
    expect(session.mode).toBe("insert");
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

describe("Replace mode", () => {
  it("leaves Enter native: Vim's Replace mode breaks the line, so the textarea gets its newline", () => {
    keys("R");
    expect(session.mode).toBe("replace");
    expect(keydown("Enter").defaultPrevented).toBe(false);
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

describe("Mode", () => {
  it("names linewise and blockwise Visual after V and Ctrl-v", () => {
    keys("V");
    expect(session.mode).toBe("visual-line");
    keydown("Escape");
    keydown("v", { ctrlKey: true });
    expect(session.mode).toBe("visual-block");
  });

  it("is command-line while the : input is open, and Normal again once Esc closes it", () => {
    keys(":");
    expect(session.mode).toBe("command-line");
    const input = session.status.statusbar.querySelector("input")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }));
    expect(session.mode).toBe("normal");
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

/**
 * The command line closes when focus leaves its input for elsewhere in the
 * page (#100); a click is covered through the built extension
 * (`tests/e2e/command-line.spec.ts`, "(#100)"). A blur event that leaves the
 * input its tree's active element closes nothing. Coverage: Normal mode on a
 * textarea.
 */
describe("The command line's input blurring", () => {
  const nextTask = () => new Promise((r) => setTimeout(r));
  let other: HTMLInputElement;

  beforeEach(() => {
    other = document.createElement("input");
    document.body.appendChild(other);
  });

  afterEach(() => other.remove());

  it("closes the command line and leaves focus where it went", async () => {
    keys("w:");
    other.focus();
    await nextTask();
    expect(session.mode).toBe("normal");
    expect(document.activeElement).toBe(other);
  });

  it("keeps the command line open after a blur event that leaves its input the active element", async () => {
    keys("w:");
    const input = session.status.statusbar.querySelector("input")!;
    input.dispatchEvent(new FocusEvent("blur"));
    await nextTask();
    expect(session.mode).toBe("command-line");
    expect(session.status.host.shadowRoot!.activeElement).toBe(input);
  });
});
