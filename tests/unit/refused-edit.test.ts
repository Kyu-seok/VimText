import { describe, it, expect, afterEach } from "vitest";
import { Session } from "../../src/bridge/Session";
import { activeHost, blockTexts, selectedText } from "./contenteditable";
import { FakeField } from "./FakeField";
import { settledKeyDriver } from "./keys";
import { statusText } from "./dom";

/**
 * An edit the editor refuses (#48; spec #40 "Writes"): the write leaves the
 * Field's text as it was, so the Field wins, the engine's change is dropped
 * from the undo history, and the Status Line says so.
 *
 * Each write step offers the page a synthetic `beforeinput` and runs the
 * editing command only if no listener cancelled it (ADR 0008), so a page that
 * cancels `beforeinput` and does nothing refuses the edit (the last describe).
 * The refusal most tests here stage is the other kind: the page's `input`
 * handler puts back its last accepted markup when an edit touched a locked
 * span, as an editor re-rendering from its own model does.
 *
 * Coverage (CODING_STANDARDS rule 5): Normal, Visual, Insert (a `Ctrl-r`
 * paste) on a contenteditable host; Normal on a textarea-like Field whose page
 * reverts the write. Replace (`R` over the span) is folded on the Insert path.
 */

const REFUSED = "VimText: the page refused the edit";

/** The page's editor: any edit that changes a `.locked` span is undone from the `input` handler. */
function lockSpans(host: HTMLElement): void {
  const lockedTexts = () => [...host.querySelectorAll(".locked")].map((s) => s.textContent);
  const locked = lockedTexts();
  let accepted = host.innerHTML;
  host.addEventListener("input", () => {
    const now = lockedTexts();
    if (now.length === locked.length && now.every((t, i) => t === locked[i])) accepted = host.innerHTML;
    else host.innerHTML = accepted;
  });
}

let current: { session: Session; destroy(): void } | null = null;

afterEach(() => {
  current?.destroy();
  current = null;
  document.body.innerHTML = "";
});

const { keydown, keys } = settledKeyDriver(() => current!.session);

// prettier-ignore
const LOCKED = '<p>ab<span class="locked">LOCK</span>cd</p><p>next line</p>';

function open(html = LOCKED) {
  const opened = activeHost(html);
  lockSpans(opened.host);
  current = opened;
  return opened;
}

describe("A refused edit on a contenteditable host", () => {
  it("x in the locked span leaves the text unchanged, the cursor on its character, and the message on the Status Line", async () => {
    const { host } = open();
    await keys("ll");
    expect(selectedText()).toBe("L");
    await keys("x");
    expect(blockTexts(host)).toEqual(["abLOCKcd", "next line"]);
    expect(selectedText()).toBe("L");
    expect(statusText()).toContain(REFUSED);
  });

  it("the next key works normally", async () => {
    const { host } = open();
    await keys("llx");
    await keys("l");
    expect(selectedText()).toBe("O");
    await keys("$x");
    expect(blockTexts(host)).toEqual(["abLOCKc", "next line"]);
    await keys("j0x");
    expect(blockTexts(host)).toEqual(["abLOCKc", "ext line"]);
  });

  it("u does not undo a change that never happened: it undoes the accepted edit before it", async () => {
    const { host } = open();
    await keys("x");
    expect(blockTexts(host)).toEqual(["bLOCKcd", "next line"]);
    await keys("lx");
    expect(blockTexts(host)).toEqual(["bLOCKcd", "next line"]);
    await keys("u");
    expect(blockTexts(host)).toEqual(["abLOCKcd", "next line"]);
    await keys("u");
    expect(blockTexts(host)).toEqual(["abLOCKcd", "next line"]);
  });

  it("an accepted edit next to the refused one still works, and u undoes only it", async () => {
    // `x` on `b` then `x` on `L` at once: the engine's history may join the two
    // adjacent changes into one undo step (docs/engine-seams.md "History grouping").
    const { host } = open();
    await keys("l");
    await keys("x");
    expect(blockTexts(host)).toEqual(["aLOCKcd", "next line"]);
    await keys("x");
    expect(blockTexts(host)).toEqual(["aLOCKcd", "next line"]);
    expect(statusText()).toContain(REFUSED);
    await keys("$x");
    expect(blockTexts(host)).toEqual(["aLOCKc", "next line"]);
    await keys("u");
    expect(blockTexts(host)).toEqual(["aLOCKcd", "next line"]);
    await keys("u");
    expect(blockTexts(host)).toEqual(["abLOCKcd", "next line"]);
  });

  it("dd over the locked line is refused whole; dd on the next line is accepted", async () => {
    const { host } = open();
    await keys("dd");
    expect(blockTexts(host)).toEqual(["abLOCKcd", "next line"]);
    expect(statusText()).toContain(REFUSED);
    await keys("jdd");
    expect(host.innerText.trim()).toBe("abLOCKcd");
  });

  it("in Visual, d over the span is refused and Normal resumes", async () => {
    const { host, session } = open();
    await keys("lvlld");
    expect(blockTexts(host)).toEqual(["abLOCKcd", "next line"]);
    expect(session.mode).toBe("normal");
    expect(statusText()).toContain(REFUSED);
  });

  it("in Insert, a Ctrl-r paste into the span is refused and Insert goes on", async () => {
    const { host, session } = open();
    await keys("ylllli");
    await keydown("r", { ctrlKey: true });
    await keydown('"');
    expect(blockTexts(host)).toEqual(["abLOCKcd", "next line"]);
    expect(session.mode).toBe("insert");
    expect(statusText()).toContain(REFUSED);
  });

  it("in Replace, a character typed over the span is refused and Replace goes on outside it", async () => {
    const { host, session } = open();
    await keys("llR");
    await keys("Z");
    expect(blockTexts(host)).toEqual(["abLOCKcd", "next line"]);
    expect(session.mode).toBe("replace");
    expect(statusText()).toContain(REFUSED);
    await keydown("Escape");
    await keys("$RY");
    expect(blockTexts(host)).toEqual(["abLOCKcY", "next line"]);
  });
});

describe("A refused write on a Field that keeps its value", () => {
  it("the page puts its value back: the text stays, the message shows, u has nothing to undo", async () => {
    const field = new FakeField("hello world");
    field.focus();
    const session = new Session(field, { vimrc: "" });
    current = {
      session,
      destroy() {
        session.destroy();
        field.destroy();
      },
    };
    await keys("x");
    expect(field.value).toBe("ello world");
    field.rewrite = () => ({ text: "ello world", caret: 0 });
    await keys("x");
    expect(field.value).toBe("ello world");
    expect(statusText()).toContain(REFUSED);
    field.rewrite = null;
    await keys("u");
    expect(field.value).toBe("hello world");
  });
});

describe("A page that cancels beforeinput (ADR 0008)", () => {
  it("cancelling every beforeinput and doing nothing is a Refused Edit: the text stays and the Status Line says so", async () => {
    const opened = activeHost("<p>hello world</p>");
    current = opened;
    opened.host.addEventListener("beforeinput", (e) => e.preventDefault());
    await keys("x");
    expect(blockTexts(opened.host)).toEqual(["hello world"]);
    expect(statusText()).toContain(REFUSED);
    await keys("wdw");
    expect(blockTexts(opened.host)).toEqual(["hello world"]);
    expect(statusText()).toContain(REFUSED);
  });
});
