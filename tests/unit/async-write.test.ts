import { describe, it, expect, afterEach, vi } from "vitest";
import { Session } from "../../src/bridge/Session";
import { TextareaField } from "../../src/field/TextareaField";
import { ContentEditableField } from "../../src/field/ContentEditableField";
import { activeHost, blockTexts, caretAt, editableHost, inputLog, selectedText } from "./contenteditable";
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
 * host in the document, Normal on a textarea and an input. Insert typing while
 * a write settles (`Session.typeWhileWriting`) on a multi-line host, a
 * Single-line host and a host in an open shadow root. Replace writes through
 * the same render, and its suite runs on this path too.
 */

const REFUSED = "VimText: the page refused the edit";

let current: { session: Session; destroy(): void } | null = null;

afterEach(() => {
  vi.restoreAllMocks();
  current?.destroy();
  current = null;
  document.body.innerHTML = "";
});

/** Keys pressed back to back, none waiting for a write. */
const { keydown, keys } = keyDriver(() => current!.session);
/** Keys pressed each once the writes before it have settled. */
const settledKeys = settledKeyDriver(() => current!.session).keys;

function open(html: string, opts: Parameters<typeof activeHost>[1] = {}) {
  const opened = activeHost(html, opts);
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

  it("on a Single-line host, Enter typed in Insert meanwhile stays the page's; characters land with the merged write", async () => {
    const host = editableHost("<p>hello</p>", { attrs: { "aria-multiline": "false" } });
    host.focus();
    caretAt(host, 0);
    const field = new ContentEditableField(host, true);
    const session = new Session(field, { vimrc: "" });
    current = {
      session,
      destroy() {
        session.destroy();
        field.destroy();
      },
    };
    keys("xia");
    const enter = keydown("Enter");
    expect(enter.defaultPrevented).toBe(false);
    keys("b");
    keydown("Escape");
    await session.settled();
    expect(blockTexts(host)).toEqual(["abello"]);
  });

  it("on a host in an open shadow root, text typed in Insert meanwhile lands where the engine's cursor is", async () => {
    const component = document.createElement("div");
    document.body.appendChild(component);
    const root = component.attachShadow({ mode: "open" });
    const { host, session } = open("<p>abc</p><p>second</p>", { parent: root });
    keys("jxOtop");
    keydown("Backspace");
    keydown("Enter");
    keys("y");
    keydown("Escape");
    await session.settled();
    expect(blockTexts(host)).toEqual(["abc", "to", "y", "econd"]);
    expect(session.mode).toBe("normal");
  });

  it("an Atom past the end of the text those keys shortened does not break the page's next rewrite", async () => {
    // When the `x` write settles, the Field's Atom sits at an offset past the
    // end of the mirror's shorter text (the `jdd` is not written yet); the
    // page then rewrites the merged write.
    const { host, session } = open('<p>one</p><p>two</p><p>a <span contenteditable="false">@x</span></p>');
    let writes = 0;
    host.addEventListener("input", () => {
      if (++writes === 2) queueMicrotask(() => (host.children[0]!.textContent = "NE"));
    });
    const errors = vi.spyOn(console, "error");
    keys("xjdd");
    await session.settled();
    expect(blockTexts(host)).toEqual(["NE", "a @x"]);
    await settledKeys("x");
    expect(blockTexts(host)).toEqual(["E", "a @x"]); // the cursor follows the page's rewrite to its caret
    expect(errors).not.toHaveBeenCalled();
  });

  it("a merged write that changes the lines on both sides of an Atom's line leaves the Atom in place", async () => {
    const { host, session } = open(
      '<p>one</p><p>two</p><p>a <span contenteditable="false">@x</span> b</p><p>three</p>',
    );
    const atom = host.querySelector('[contenteditable="false"]');
    keys("xjddGdd"); // both dd merge into one write while the `x` one settles
    await session.settled();
    expect(blockTexts(host)).toEqual(["ne", "a @x b"]);
    expect(host.querySelector('[contenteditable="false"]')).toBe(atom);
    await settledKeys("uuu");
    expect(blockTexts(host)).toEqual(["one", "two", "a @x b", "three"]);
    expect(host.querySelectorAll('[contenteditable="false"]')).toHaveLength(1);
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

describe("A refused line break typed while a write is pending (#68)", () => {
  it("drops only the line break: the text typed after it is written on the line, and the Status Line says so", async () => {
    // Notion and Slack cancel a synthetic paragraph break and do nothing.
    // `fast` is typed while that write is pending, as a person typing on does.
    const { host, session } = open("<p>abc</p>");
    let typed = false;
    host.addEventListener("beforeinput", (e) => {
      if (e.inputType !== "insertParagraph" && e.inputType !== "insertLineBreak") return;
      e.preventDefault();
      if (!typed) {
        typed = true;
        keys("fast");
      }
    });
    keys("A");
    keydown("Enter");
    await session.settled();
    expect(typed).toBe(true);
    expect(blockTexts(host)).toEqual(["abcfast"]);
    expect(statusText()).toContain(REFUSED);
    keydown("Escape");
    await session.settled();
    expect(blockTexts(host)).toEqual(["abcfast"]);
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
    // Destroyed as the first step lands: that step may first wait out the gap
    // after the cursor the Session set (`WRITE_GAP_MS`).
    const ended = new Promise<void>((resolve) =>
      host.addEventListener(
        "input",
        () => {
          session.destroy();
          field.destroy();
          resolve();
        },
        { once: true },
      ),
    );
    keys("yyp"); // one write in two steps: insertParagraph, then insertText "one"
    await ended;
    expect(inputs(log)).toEqual(["input:insertParagraph"]);
    await new Promise((r) => setTimeout(r, 50));
    expect(inputs(log)).toEqual(["input:insertParagraph"]);
    expect(blockTexts(host)).toEqual(["one", "", "two"]);
  });
});

describe("A Session that ends mid-write with keys queued", () => {
  it("never writes the merged render of the keys pressed during the write", async () => {
    const { host, session, field } = open("<p>abcdef</p>");
    const log = inputLog(host);
    const ended = new Promise<void>((resolve) =>
      host.addEventListener(
        "input",
        () => {
          session.destroy();
          field.destroy();
          resolve();
        },
        { once: true },
      ),
    );
    keys("xxx"); // the first `x` writes; the other two wait in a merged render
    await ended;
    await new Promise((r) => setTimeout(r, 50));
    expect(inputs(log)).toEqual(["input:deleteContentBackward"]);
    expect(blockTexts(host)).toEqual(["bcdef"]);
  });
});

describe("A textarea or input write", () => {
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

  it("stays synchronous on an input: the Field holds the text right after the key", () => {
    const input = document.createElement("input");
    input.value = "hello world";
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(0, 0);
    const field = new TextareaField(input);
    const session = new Session(field, { vimrc: "" });
    current = {
      session,
      destroy() {
        session.destroy();
        field.destroy();
      },
    };
    keys("x");
    expect(input.value).toBe("ello world");
    keys("dw");
    expect(input.value).toBe("world");
  });
});
