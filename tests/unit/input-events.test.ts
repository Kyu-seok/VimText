import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TextareaField } from "../../src/field/TextareaField";
import { Session } from "../../src/bridge/Session";

// The page's view of a write: what a mask library or a framework's `onChange`
// would read off the synthetic `input` event. Nothing here reaches into the engine.
interface SeenInput {
  inputType: string;
  data: string | null;
  bubbles: boolean;
}

let ta: HTMLTextAreaElement;
let field: TextareaField;
let session: Session;
let seen: SeenInput[];

function record(e: Event): void {
  const ie = e as InputEvent;
  seen.push({ inputType: ie.inputType, data: ie.data, bubbles: ie.bubbles });
}

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
  const s = selectionStart ?? 0,
    e = selectionEnd ?? s;
  ta.value = value.slice(0, s) + text + value.slice(e);
  ta.setSelectionRange(s + text.length, s + text.length);
  ta.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
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
  seen = [];
  ta.addEventListener("input", record);
});

afterEach(() => {
  ta.removeEventListener("input", record);
  session.destroy();
  field.destroy();
  ta.remove();
});

describe("synthetic input events say what the edit was", () => {
  it("p is an insertText carrying the pasted text", () => {
    keys("yiwp");
    expect(ta.value).toMatch(/^tthehe quick/);
    expect(seen).toEqual([{ inputType: "insertText", data: "the", bubbles: true }]);
  });

  it("x is a deleteContentBackward with no data", () => {
    keys("x");
    expect(ta.value).toMatch(/^he quick/);
    expect(seen).toEqual([{ inputType: "deleteContentBackward", data: null, bubbles: true }]);
  });

  it("dd is a deleteContentBackward with no data", () => {
    keys("dd");
    expect(ta.value).toMatch(/^jumps over/);
    expect(seen).toEqual([{ inputType: "deleteContentBackward", data: null, bubbles: true }]);
  });

  it("ciw removes the word as a deletion; committing and repeating it is an insertText with the typed text", () => {
    ta.setSelectionRange(5, 5);
    keys("ciw");
    expect(seen).toEqual([{ inputType: "deleteContentBackward", data: null, bubbles: true }]);
    seen = [];
    typeNatively("fast"); // native typing: the page's own event, not ours
    keydown("Escape"); // the Field already holds the text; nothing to write
    expect(ta.value).toMatch(/^the fast brown/);
    expect(seen.filter((e) => e.data !== "fast")).toEqual([]);
    seen = [];
    keys("w."); // the replacement "brown" -> "fast" is one write
    expect(ta.value).toMatch(/^the fast fast fox/);
    expect(seen).toEqual([{ inputType: "insertText", data: "fast", bubbles: true }]);
  });

  it("bubbles to a document-level listener with its inputType intact", () => {
    const atDocument: string[] = [];
    const listener = (e: Event) => atDocument.push((e as InputEvent).inputType);
    document.addEventListener("input", listener);
    try {
      keys("x");
    } finally {
      document.removeEventListener("input", listener);
    }
    expect(atDocument).toEqual(["deleteContentBackward"]);
  });
});
