import { describe, it, expect, afterEach, vi } from "vitest";
import { FakeField } from "./FakeField";
import { Session } from "../../src/bridge/Session";

let field: FakeField;
let session: Session;

function keydown(key: string, init: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true, ...init });
  session.handleKeydown(e);
  return e;
}

function keys(seq: string): void {
  for (const ch of seq) keydown(ch);
}

/** A mask that keeps the Field four characters wide, padding with `_` (its own output is a fixed point). */
function fourWide(text: string): { text: string } {
  return { text: (text.replace(/_+$/, "") + "____").slice(0, 4) };
}

function start(value: string, singleLine = true): void {
  field = new FakeField(value, { singleLine });
  field.focus();
  session = new Session(field, { vimrc: "" });
}

afterEach(() => {
  session.destroy();
  field.destroy();
});

describe("Controlled Field: synchronous rewrite inside the write", () => {
  it("x keeps the page's text; one u restores the original; . repeats", () => {
    start("abc_");
    field.rewrite = fourWide;
    keys("x");
    expect(field.value).toBe("bc__");
    keys("u");
    expect(field.value).toBe("abc_");
    keys(".");
    expect(field.value).toBe("bc__");
  });

  it("an uppercase filter: u moves back in one step, to the original as the page shows it", () => {
    start("hello world");
    field.rewrite = (text) => ({ text: text.toUpperCase() });
    keys("x");
    expect(field.value).toBe("ELLO WORLD");
    keys("u");
    // The page uppercases the restored text as it does any write; what matters
    // is that the deleted character is back and a second u has nothing to churn on.
    expect(field.value).toBe("HELLO WORLD");
    keys("u");
    expect(field.value).toBe("HELLO WORLD");
  });

  it("in Insert, a Ctrl-r paste and the page's rewrite of it are one undo step, however slow the page", () => {
    start("hello world");
    // The engine's history also groups adjacent changes made within 500 ms
    // (engine seams: "History grouping"); a page that takes longer to rewrite
    // shows the join is the bridge's doing.
    vi.useFakeTimers({ toFake: ["Date"] });
    field.rewrite = (text) => {
      vi.setSystemTime(Date.now() + 1000);
      return { text: text.toUpperCase() };
    };
    keys("yiwA");
    keydown("r", { ctrlKey: true });
    keydown('"');
    vi.useRealTimers();
    expect(field.value).toBe("HELLO WORLDHELLO");
    expect(session.mode).toBe("insert");
    keydown("Escape");
    keys("u");
    expect(field.value).toBe("HELLO WORLD");
  });

  it("puts the cursor where the page left the caret, clipped to the line in Normal", () => {
    start("hello world");
    field.rewrite = (text) => ({ text: text.toUpperCase() }); // caret parks at the end, as `el.value = …` does
    keys("x");
    expect(field.selection).toEqual({ anchor: 9, head: 10 });
    keys("x");
    expect(field.value).toBe("ELLO WORL");
  });

  it("follows a page that restores the caret after its rewrite", () => {
    start("abc_");
    field.rewrite = (text) => ({ ...fourWide(text), caret: 1 });
    keys("lx");
    expect(field.value).toBe("ac__");
    expect(field.selection).toEqual({ anchor: 1, head: 2 });
  });
});

describe("Controlled Field: rewrite that arrives after the write", () => {
  it("syncs through its own input event as a separate undo step", () => {
    start("hello world");
    keys("x");
    expect(field.value).toBe("ello world");
    field.pageInput("ELLO WORLD"); // a `setTimeout` reformat: the page sets the value and fires `input`
    keys("u");
    expect(field.value).toBe("ello world");
    keys("u");
    expect(field.value).toBe("hello world");
  });
});

describe("Rule-1 window: the page changes the Field between a queued render and its flush", () => {
  /** Runs an ex command through the command line, as the user does: the mirror changes and a render is queued. */
  function exCommand(line: string): void {
    keys(":");
    const input = document.querySelector("vimtext-status")!.shadowRoot!.querySelector("input")!;
    input.value = line;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
  }

  it("does not write; the Field wins and the engine's change is gone, from the undo history too", async () => {
    start("the quick fox");
    exCommand("s/quick/slow/");
    field.pageSet("page wins");
    const writes = field.writes.length;
    await new Promise((r) => setTimeout(r, 0));
    expect(field.writes.length).toBe(writes);
    expect(field.value).toBe("page wins");
    keys("$x");
    expect(field.value).toBe("page win");
    keys("uu");
    expect(field.value).toBe("the quick fox");
    expect(field.writes).not.toContain("the slow fox");
  });
});
