import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TextareaField } from "../../src/field/TextareaField";
import { Session } from "../../src/bridge/Session";
import { surround } from "../../src/plugins/surround";
import { keyDriver } from "./keys";

let input: HTMLInputElement;
let field: TextareaField;
let session: Session;

const { keydown, keys } = keyDriver(() => session);

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

describe("Key Policy on a Single-line Field", () => {
  it("o in Normal is swallowed as a beep: Normal stays, text unchanged, pending count cleared", () => {
    expect(keydown("o").defaultPrevented).toBe(true);
    expect(session.mode).toBe("normal");
    expect(input.value).toBe("hello world");
    keys("3o");
    expect(session.mode).toBe("normal");
    keys("x");
    expect(input.value).toBe("ello world"); // not "lo world": the 3 was cleared with the o
    keys("O");
    expect(session.mode).toBe("normal");
    expect(input.value).toBe("ello world");
  });

  it('"ao beeps too: a register prefix is not an operator, and it is dropped with the beep', () => {
    keys('"a');
    expect(keydown("o").defaultPrevented).toBe(true);
    expect(session.mode).toBe("normal");
    expect(input.value).toBe("hello world");
    keys("x"); // the prefix went with the beep: the char lands in the unnamed register, not "a
    keys("p");
    expect(input.value).toBe("ehllo world");
  });

  it("Visual o still jumps to the other end of the selection", () => {
    keys("vl");
    expect(session.mode).toBe("visual");
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([0, 2, "forward"]);
    keys("o");
    expect(session.mode).toBe("visual");
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([0, 2, "backward"]);
  });

  it("Enter in plain Normal is a Pass-through (submits); with a pending operator it is the engine's", () => {
    expect(keydown("Enter").defaultPrevented).toBe(false);
    keys("d");
    expect(keydown("Enter").defaultPrevented).toBe(true);
    keys("3");
    expect(keydown("Enter").defaultPrevented).toBe(true);
  });
});

describe("Key Policy row 7 yields to a partial key", () => {
  /** Runs an ex command through the command line, as the user does. */
  function exCommand(line: string): void {
    keys(":");
    const cmdline = session.status.statusbar.querySelector("input")!;
    cmdline.value = line;
    cmdline.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
  }

  // `go` is unbound upstream, so a beep and the engine's own "no such
  // command" look alike from the Field; a mapping makes the difference visible.
  beforeEach(() => {
    session.destroy();
    session = new Session(field, { vimrc: "nnoremap go A" });
  });

  afterEach(() => {
    keydown("Escape");
    exCommand("unmap go"); // mappings are global across every mirror
  });

  it("go is the engine's: with g pending, o completes a different command", () => {
    keys("go");
    expect(session.mode).toBe("insert");
    expect(input.selectionStart).toBe("hello world".length);
  });
});

describe("surround on a Single-line Field", () => {
  beforeEach(() => {
    session.destroy();
    session = new Session(field, { vimrc: "", plugins: [surround] });
  });

  it("linewise Visual S) yields (text): the delimiters' own lines lose their newlines to the strip", () => {
    keys("VS)");
    expect(input.value).toBe("(hello world)");
    keys("u");
    expect(input.value).toBe("hello world");
  });
});

describe("Key Policy on a textarea", () => {
  it("Enter in Normal is still the Vim motion", () => {
    const ta = document.createElement("textarea");
    ta.value = "first line\n  second line";
    document.body.appendChild(ta);
    ta.focus();
    ta.setSelectionRange(0, 0);
    const taField = new TextareaField(ta);
    const taSession = new Session(taField, { vimrc: "" });
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    taSession.handleKeydown(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(ta.value).toBe("first line\n  second line");
    expect(ta.selectionStart).toBe("first line\n  ".length); // first non-blank of the next line
    taSession.destroy();
    taField.destroy();
    ta.remove();
  });
});
