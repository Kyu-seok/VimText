import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TextareaField } from "../../src/field/TextareaField";
import { Session } from "../../src/bridge/Session";

let input: HTMLInputElement;
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

beforeEach(() => {
  input = document.createElement("input");
  input.type = "text";
  input.value = "hello world";
  input.style.cssText = "width:320px;font:14px monospace";
  document.body.appendChild(input);
  input.focus();
  input.setSelectionRange(0, 0);
  field = new TextareaField(input);
  session = new Session(field, { vimrc: "" });
});

afterEach(() => {
  session.destroy();
  field.destroy();
  input.remove();
});

describe("Single-line Field never holds a newline", () => {
  it("yyp concatenates the line with itself; one u restores it", () => {
    keys("yyp");
    expect(input.value).toBe("hello worldhello world");
    keys("u");
    expect(input.value).toBe("hello world");
  });

  it(". repeats a command that involved a strip with the same stripped result", () => {
    // The engine's history groups adjacent changes typed within 500 ms into one
    // undo step (engine seams: "History grouping"); a person types `.` later.
    vi.useFakeTimers({ toFake: ["Date"] });
    keys("yyp");
    vi.advanceTimersByTime(1000);
    keys(".");
    vi.useRealTimers();
    expect(input.value).toBe("hello worldhello worldhello world");
    keys("u");
    expect(input.value).toBe("hello worldhello world");
    keys("u");
    expect(input.value).toBe("hello world");
  });

  it("Ctrl-r in Insert with a two-line register pastes the lines joined; one u undoes the paste", () => {
    yankTwoLinesIntoUnnamedRegister("foo\nbar");
    keys("A");
    keydown("r", { ctrlKey: true });
    keydown('"');
    expect(input.value).toBe("hello worldfoobar");
    expect(session.mode).toBe("insert");
    keydown("Escape");
    keys("u");
    expect(input.value).toBe("hello world");
  });

  it(":s/ /\\r/ leaves no newline and is one undo step", async () => {
    keys(":");
    // The command line lives in the Status Line's shadow root; the engine reads it on Enter.
    const cmdline = session.status.statusbar.querySelector("input")!;
    cmdline.value = "s/ /\\r/";
    cmdline.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true, cancelable: true }),
    );
    await Promise.resolve(); // the ex command renders on a microtask
    expect(input.value).toBe("helloworld");
    keys("u");
    expect(input.value).toBe("hello world");
  });
});

/** Registers are Session State shared by every Field: a textarea fills the unnamed register. */
function yankTwoLinesIntoUnnamedRegister(twoLines: string): void {
  const ta = document.createElement("textarea");
  ta.value = twoLines;
  document.body.appendChild(ta);
  ta.setSelectionRange(0, 0);
  const taField = new TextareaField(ta);
  const taSession = new Session(taField, { vimrc: "" });
  for (const ch of "yj") {
    taSession.handleKeydown(new KeyboardEvent("keydown", { key: ch, bubbles: true, cancelable: true }));
  }
  taSession.destroy();
  taField.destroy();
  ta.remove();
  input.focus();
}
