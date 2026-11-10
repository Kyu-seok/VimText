import { describe, it, expect, afterEach } from "vitest";
import { Session } from "../../src/bridge/Session";
import { activeHost, blockTexts, selectedText } from "./contenteditable";
import { FakeField } from "./FakeField";
import { keyDriver } from "./keys";
import { statusText } from "./dom";

/**
 * An edit the editor refuses (#48; spec #40 "Writes"): the write leaves the
 * Field's text as it was, so the Field wins, the engine's change is dropped
 * from the undo history, and the Status Line says so.
 *
 * Chrome's editing commands fire `input` but not `beforeinput` (docs/engine-seams.md
 * "Refused edits"), so a page that cancels `beforeinput` does not stop them.
 * The refusal these tests stage is one that does happen: the page's `input`
 * handler puts back its last accepted markup when an edit touched a locked
 * span, as an editor re-rendering from its own model does.
 *
 * Coverage (CODING_STANDARDS rule 5): Normal, Visual and Insert (a `Ctrl-r`
 * paste) on a contenteditable host; Normal on a textarea-like Field whose page
 * reverts the write. Replace mode goes through the same Insert path.
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

const { keydown, keys } = keyDriver(() => current!.session);

// prettier-ignore
const LOCKED = '<p>ab<span class="locked">LOCK</span>cd</p><p>next line</p>';

function open(html = LOCKED) {
  const opened = activeHost(html);
  lockSpans(opened.host);
  current = opened;
  return opened;
}

describe("A refused edit on a contenteditable host", () => {
  it("x in the locked span leaves the text unchanged, the cursor on its character, and the message on the Status Line", () => {
    const { host } = open();
    keys("ll");
    expect(selectedText()).toBe("L");
    keys("x");
    expect(blockTexts(host)).toEqual(["abLOCKcd", "next line"]);
    expect(selectedText()).toBe("L");
    expect(statusText()).toContain(REFUSED);
  });

  it("the next key works normally", () => {
    const { host } = open();
    keys("llx");
    keys("l");
    expect(selectedText()).toBe("O");
    keys("$x");
    expect(blockTexts(host)).toEqual(["abLOCKc", "next line"]);
    keys("j0x");
    expect(blockTexts(host)).toEqual(["abLOCKc", "ext line"]);
  });

  it("u does not undo a change that never happened: it undoes the accepted edit before it", () => {
    const { host } = open();
    keys("x");
    expect(blockTexts(host)).toEqual(["bLOCKcd", "next line"]);
    keys("lx");
    expect(blockTexts(host)).toEqual(["bLOCKcd", "next line"]);
    keys("u");
    expect(blockTexts(host)).toEqual(["abLOCKcd", "next line"]);
    keys("u");
    expect(blockTexts(host)).toEqual(["abLOCKcd", "next line"]);
  });

  it("an accepted edit next to the refused one still works, and u undoes only it", () => {
    // `x` on `b` then `x` on `L` at once: the engine's history may join the two
    // adjacent changes into one undo step (docs/engine-seams.md "History grouping").
    const { host } = open();
    keys("l");
    keys("x");
    expect(blockTexts(host)).toEqual(["aLOCKcd", "next line"]);
    keys("x");
    expect(blockTexts(host)).toEqual(["aLOCKcd", "next line"]);
    expect(statusText()).toContain(REFUSED);
    keys("$x");
    expect(blockTexts(host)).toEqual(["aLOCKc", "next line"]);
    keys("u");
    expect(blockTexts(host)).toEqual(["aLOCKcd", "next line"]);
    keys("u");
    expect(blockTexts(host)).toEqual(["abLOCKcd", "next line"]);
  });

  it("dd over the locked line is refused whole; dd on the next line is accepted", () => {
    const { host } = open();
    keys("dd");
    expect(blockTexts(host)).toEqual(["abLOCKcd", "next line"]);
    expect(statusText()).toContain(REFUSED);
    keys("jdd");
    expect(host.innerText.trim()).toBe("abLOCKcd");
  });

  it("in Visual, d over the span is refused and Normal resumes", () => {
    const { host, session } = open();
    keys("lvlld");
    expect(blockTexts(host)).toEqual(["abLOCKcd", "next line"]);
    expect(session.mode).toBe("normal");
    expect(statusText()).toContain(REFUSED);
  });

  it("in Insert, a Ctrl-r paste into the span is refused and Insert goes on", () => {
    const { host, session } = open();
    keys("ylllli");
    keydown("r", { ctrlKey: true });
    keydown('"');
    expect(blockTexts(host)).toEqual(["abLOCKcd", "next line"]);
    expect(session.mode).toBe("insert");
    expect(statusText()).toContain(REFUSED);
  });
});

describe("A refused write on a Field that keeps its value", () => {
  it("the page puts its value back: the text stays, the message shows, u has nothing to undo", () => {
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
    keys("x");
    expect(field.value).toBe("ello world");
    field.rewrite = () => ({ text: "ello world", caret: 0 });
    keys("x");
    expect(field.value).toBe("ello world");
    expect(statusText()).toContain(REFUSED);
    field.rewrite = null;
    keys("u");
    expect(field.value).toBe("hello world");
  });
});

describe('What Chromium refuses (docs/engine-seams.md "Refused edits")', () => {
  it("a page that cancels beforeinput does not stop the write: the editing command fires none", () => {
    const opened = activeHost("<p>hello world</p>");
    current = opened;
    opened.host.addEventListener("beforeinput", (e) => e.preventDefault());
    keys("x");
    expect(blockTexts(opened.host)).toEqual(["ello world"]);
    expect(statusText()).not.toContain(REFUSED);
  });
});
