import { describe, it, expect, afterEach } from "vitest";
import { Session } from "../../src/bridge/Session";
import { TextareaField } from "../../src/field/TextareaField";
import { activeHost, blockTexts, inputLog, selectedText } from "./contenteditable";
import { keyDriver, settledKeyDriver } from "./keys";
import { statusText } from "./dom";

/**
 * A write to a contenteditable Field settles asynchronously (#52, ADR 0008):
 * its steps are spaced a task apart, keys pressed meanwhile reach the engine
 * at once, and the renders they make merge into one write after the pending
 * one settles; the Refused Edit and Controlled Field checks read the Field
 * once the write has settled. The tests press keys through a Session as the
 * content entry does, several without waiting between them, and observe the
 * page: the host's blocks, the `input` events its editor gets, the selection,
 * the Status Line.
 *
 * Coverage (CODING_STANDARDS rule 5): Normal and Visual on a contenteditable
 * host in the document, Normal on a textarea. Insert typing is native and
 * writes nothing; Replace, a Single-line host and a host in a shadow root
 * write through the same render, and their suites run on this path too.
 */

const REFUSED = "VimText: the page refused the edit";

let current: { session: Session; destroy(): void } | null = null;

afterEach(() => {
  current?.destroy();
  current = null;
  document.body.innerHTML = "";
});

/** Keys pressed back to back, none waiting for a write. */
const { keydown, keys } = keyDriver(() => current!.session);
/** Keys pressed each once the writes before it have settled. */
const settledKeys = settledKeyDriver(() => current!.session).keys;

function open(html: string) {
  const opened = activeHost(html);
  current = opened;
  return opened;
}

/** The `input` events the host fired, by type. */
function inputs(log: string[]): string[] {
  return log.filter((e) => e.startsWith("input:"));
}

describe("Keys pressed while a write is pending", () => {
  it("all apply, in order, as one merged write after the pending one", async () => {
    const { host, session } = open("<p>abcdef</p><p>second</p>");
    const log = inputLog(host);
    keys("xxx");
    await session.settled();
    expect(blockTexts(host)).toEqual(["def", "second"]);
    expect(inputs(log)).toEqual(["input:deleteContentBackward", "input:deleteContentBackward"]);
    expect(selectedText()).toBe("d");
  });

  it("a Visual delete pressed meanwhile applies after the write", async () => {
    const { host, session } = open("<p>abcdef</p><p>second</p>");
    keys("xvld");
    await session.settled();
    expect(blockTexts(host)).toEqual(["def", "second"]);
    expect(session.mode).toBe("normal");
    expect(selectedText()).toBe("d");
  });

  it("text typed in Insert meanwhile lands where the engine's cursor is, not where the Field's caret was", async () => {
    // The `O` write is pending while `top` is typed: typed natively, it would land at the old caret.
    const { host, session } = open("<p>abc</p><p>second</p>");
    keys("jxOtop");
    keydown("Backspace");
    keydown("Enter");
    keys("z");
    keydown("Backspace");
    keys("y");
    keydown("Escape");
    await session.settled();
    expect(blockTexts(host)).toEqual(["abc", "to", "y", "econd"]);
    expect(session.mode).toBe("normal");
    await settledKeys("u");
    expect(blockTexts(host)).toEqual(["abc", "econd"]);
  });

  it("a cursor motion pressed meanwhile lands after the write", async () => {
    const { host, session } = open("<p>abcdef</p>");
    keys("xll");
    await session.settled();
    expect(blockTexts(host)).toEqual(["bcdef"]);
    expect(selectedText()).toBe("d");
  });
});

describe("A write judged once it has settled", () => {
  it("an editor that puts its markup back a microtask after the write is a Refused Edit, with the message", async () => {
    const { host, session } = open('<p>ab<span class="locked">LOCK</span>cd</p>');
    const accepted = host.innerHTML;
    // As an editor reconciling from its model does: the revert comes after the `input` event, not inside it.
    host.addEventListener("input", () => queueMicrotask(() => (host.innerHTML = accepted)));
    keys("llx");
    await session.settled();
    expect(blockTexts(host)).toEqual(["abLOCKcd"]);
    expect(statusText()).toContain(REFUSED);
    expect(selectedText()).toBe("L");
  });

  it("a Controlled Field rewrite a microtask after the write is followed, joined to that change's undo step", async () => {
    const { host, session } = open("<p>ab-x</p>");
    // A smart-dash rule: the page turns "--" into an em dash once the edit is in.
    host.addEventListener("input", () =>
      queueMicrotask(() => {
        const p = host.firstElementChild!;
        if (p.textContent!.includes("--")) p.textContent = p.textContent!.replace("--", "—");
      }),
    );
    keys("$r-");
    await session.settled();
    expect(blockTexts(host)).toEqual(["ab—"]);
    expect(statusText()).not.toContain(REFUSED);
    await settledKeys("$x");
    expect(blockTexts(host)).toEqual(["ab"]);
    await settledKeys("u");
    expect(blockTexts(host)).toEqual(["ab—"]);
    await settledKeys("u");
    expect(blockTexts(host)).toEqual(["ab-x"]);
  });
});

describe("Keys pressed during a write the page then changes", () => {
  /** A smart-dash rule: the page turns "--" into an em dash a microtask after the edit is in. */
  function smartDashes(host: HTMLElement): void {
    host.addEventListener("input", () =>
      queueMicrotask(() => {
        for (const p of host.children) {
          if (p.textContent!.includes("--")) p.textContent = p.textContent!.replace("--", "—");
        }
      }),
    );
  }

  it("a rewrite and an edit elsewhere both stand; u takes them back one step at a time", async () => {
    const { host, session } = open("<p>ab-x</p>");
    smartDashes(host);
    keys("$r-0x"); // the `x` is pressed before the `r-` write has settled
    await session.settled();
    expect(blockTexts(host)).toEqual(["b—"]);
    expect(statusText()).not.toContain(REFUSED);
    await settledKeys("u");
    expect(blockTexts(host)).toEqual(["ab—"]);
    await settledKeys("u");
    expect(blockTexts(host)).toEqual(["ab-x"]);
  });

  it("the page's change on another line stands beside the keys' edit", async () => {
    const { host, session } = open("<p>one</p><p>two</p>");
    host.addEventListener("input", () => queueMicrotask(() => (host.children[1]!.textContent = "TWO")), {
      once: true,
    });
    keys("xx");
    await session.settled();
    expect(blockTexts(host)).toEqual(["e", "TWO"]);
  });
});

describe("A Session that ends mid-write", () => {
  it("throws nothing and writes nothing more: the step that ran stays, the rest is dropped", async () => {
    const { host, session, field } = open("<p>one</p><p>two</p>");
    const log = inputLog(host);
    keys("yyp"); // one write in two steps: insertParagraph, then insertText "one"
    expect(inputs(log)).toEqual(["input:insertParagraph"]);
    session.destroy();
    field.destroy();
    await new Promise((r) => setTimeout(r, 50));
    expect(inputs(log)).toEqual(["input:insertParagraph"]);
    expect(blockTexts(host)).toEqual(["one", "", "two"]);
  });
});

describe("A textarea write", () => {
  it("stays synchronous: the Field holds the text right after the key", () => {
    const ta = document.createElement("textarea");
    ta.value = "hello\nworld";
    document.body.appendChild(ta);
    ta.focus();
    ta.setSelectionRange(0, 0);
    const field = new TextareaField(ta);
    const session = new Session(field, { vimrc: "" });
    current = {
      session,
      destroy() {
        session.destroy();
        field.destroy();
      },
    };
    keys("x");
    expect(ta.value).toBe("ello\nworld");
    keys("yyp");
    expect(ta.value).toBe("ello\nello\nworld");
  });
});
