import { describe, it, expect, afterEach } from "vitest";
import { Session } from "../../src/bridge/Session";
import { TextareaField } from "../../src/field/TextareaField";
import { Sessions } from "../../src/content/Sessions";
import { project } from "../../src/field/projection";
import {
  activeHost,
  blockTexts,
  editableHost,
  caretAt,
  inputLog,
  isCaretIn,
  selectedText,
  THREE_LINES,
  typeNatively,
} from "./contenteditable";
import { settledKeyDriver } from "./keys";
import { hostCount, keydown as keydownOn, settle, statusText } from "./dom";
import { controlledPort, settingsFor } from "./settings-port";

/**
 * Vim on a bare contenteditable of plain blocks (#44): keys go in through a
 * Session as the content entry's listener feeds them, and the tests observe
 * the page: the host's blocks, the events its editor sees, the native
 * selection and the Status Line.
 *
 * Coverage (CODING_STANDARDS rule 5): Normal, Visual, Insert and Replace on a
 * contenteditable host in the document, and on a block of a Notion-like root
 * the caret leaves and comes back to (#69). A host in an open shadow root is
 * `contenteditable-shadow.test.ts` (#50), the Notion-like root there too.
 */

let current: ReturnType<typeof activeHost> | null = null;
const cleanups: Array<() => void> = [];

afterEach(() => {
  current?.destroy();
  current = null;
  for (const c of cleanups.splice(0)) c();
  document.body.innerHTML = "";
});

const { keydown, keys } = settledKeyDriver(() => current!.session);

function open(html = THREE_LINES) {
  current = activeHost(html);
  return current;
}

describe("Activation on a contenteditable host", () => {
  it("Esc Activates the host and shows the Status Line; a key inside a nested element routes to it", async () => {
    const port = controlledPort();
    const sessions = new Sessions(document, port.port, location.origin);
    cleanups.push(() => sessions.destroy());
    port.arrive(settingsFor(null));
    await settle();
    const host = editableHost(THREE_LINES);
    host.querySelector("p")!.innerHTML = "the <b>quick</b> brown fox";
    host.focus();
    caretAt(host.querySelector("p")!.firstChild!, 0);
    expect(keydownOn(host, "Escape").defaultPrevented).toBe(true);
    expect(statusText()).toContain("NORMAL");
    keydownOn(host.querySelector("b")!, "x");
    // The write lands asynchronously (ADR 0008).
    await expect.poll(() => blockTexts(host)[0]).toBe("he quick brown fox");
  });

  it("on a page root holding blocks marked contenteditable (Notion), Esc Activates the block with the caret and edits stay in it (#69)", async () => {
    const port = controlledPort();
    const sessions = new Sessions(document, port.port, location.origin);
    cleanups.push(() => sessions.destroy());
    port.arrive(settingsFor(null));
    await settle();
    const root = editableHost(
      '<div id="a" contenteditable="true">alpha beta</div><div id="b" contenteditable="true">line one<br>line two<br>line three</div>',
    );
    const [a, b] = [document.getElementById("a")!, document.getElementById("b")!];
    root.focus();
    caretAt(b.lastChild!, 4);
    expect(keydownOn(root, "Escape").defaultPrevented).toBe(true);
    expect(statusText()).toContain("NORMAL");
    for (const k of ["g", "g", "J"]) keydownOn(root, k);
    await expect.poll(() => b.innerText).toBe("line one line two\nline three");
    expect(a.innerText).toBe("alpha beta");
    for (const k of ["g", "g", "k", "d", "d"]) keydownOn(root, k);
    await expect.poll(() => b.innerText).toBe("line three");
    expect(a.innerText).toBe("alpha beta");
  });

  it("on a Notion-like root, moving the caret to another block hides the Status Line of the one left; back in a block with a Session shows its own (#69)", async () => {
    const port = controlledPort();
    const sessions = new Sessions(document, port.port, location.origin);
    cleanups.push(() => sessions.destroy());
    port.arrive(settingsFor(null));
    await settle();
    const root = editableHost(
      '<div id="a" contenteditable="true">alpha</div><div id="b" contenteditable="true">beta</div>',
    );
    const [a, b] = [document.getElementById("a")!, document.getElementById("b")!];
    const visible = () =>
      [...document.querySelectorAll<HTMLElement>("vimtext-status")].filter((h) => h.style.display !== "none")
        .length;
    root.focus();
    caretAt(b.firstChild!, 0);
    keydownOn(root, "Escape");
    expect(visible()).toBe(1);
    caretAt(a.firstChild!, 0);
    await expect.poll(visible).toBe(0);
    keydownOn(root, "Escape");
    expect(visible()).toBe(1);
    const shownIn = () =>
      [...document.querySelectorAll<HTMLElement>("vimtext-status")].map((h) => h.style.display !== "none");
    const aShown = shownIn();
    caretAt(b.firstChild!, 0);
    // a's bar hides and b's shows again: still one, but not the same one.
    await expect.poll(() => shownIn().join()).not.toBe(aShown.join());
    expect(visible()).toBe(1);
    keydownOn(root, "x");
    await expect.poll(() => b.innerText).toBe("eta");
    expect(a.innerText).toBe("alpha");
  });

  describe("on a Notion-like root, the caret leaving a block and coming back in each mode (#69)", () => {
    /** A Session on block `#b` of a Notion-like root, in the mode `enter` puts it in. */
    async function inBlock(enter: string[]) {
      const port = controlledPort();
      const sessions = new Sessions(document, port.port, location.origin);
      cleanups.push(() => sessions.destroy());
      port.arrive(settingsFor(null));
      await settle();
      const root = editableHost(
        '<div id="a" contenteditable="true">alpha</div><div id="b" contenteditable="true">beta gamma</div>',
      );
      const [a, b] = [document.getElementById("a")!, document.getElementById("b")!];
      root.focus();
      caretAt(b.firstChild!, 0);
      for (const k of ["Escape", ...enter]) keydownOn(root, k);
      return { root, a, b };
    }
    const shown = () =>
      [...document.querySelectorAll<HTMLElement>("vimtext-status")].some((h) => h.style.display !== "none");

    /** Moves the caret to `a`, checks the bar hides and `a` is untouched, then puts it back in `b` at offset 5. */
    async function leaveAndReturn(a: HTMLElement, b: HTMLElement) {
      caretAt(a.firstChild!, 2);
      await expect.poll(shown).toBe(false);
      expect(a.innerText).toBe("alpha");
      caretAt(b.firstChild!, 5);
      await expect.poll(shown).toBe(true);
    }

    for (const [mode, enter, label] of [
      ["Insert", ["i"], "INSERT"],
      ["Replace", ["R"], "REPLACE"],
    ] as const) {
      it(`${mode} is kept, and Esc then x acts at the caret the page put in the block`, async () => {
        const { root, a, b } = await inBlock([...enter]);
        expect(statusText()).toContain(label);
        await leaveAndReturn(a, b);
        expect(statusText()).toContain(label);
        for (const k of ["Escape", "x"]) keydownOn(root, k);
        await expect.poll(() => b.innerText).toBe("betagamma");
        expect(a.innerText).toBe("alpha");
      });
    }

    for (const [mode, enter, label] of [
      ["Visual", ["v", "l"], "VISUAL"],
      ["Visual Line", ["V"], "VISUAL LINE"],
    ] as const) {
      it(`${mode} ends at the caret the page put in the block, in Normal`, async () => {
        const { root, a, b } = await inBlock([...enter]);
        expect(statusText()).toContain(label);
        await leaveAndReturn(a, b);
        await expect.poll(statusText).toContain("NORMAL");
        keydownOn(root, "x");
        await expect.poll(() => b.innerText).toBe("beta amma");
        expect(a.innerText).toBe("alpha");
      });
    }
  });

  it("the Session ends when the host stops being editable", async () => {
    const port = controlledPort();
    const sessions = new Sessions(document, port.port, location.origin);
    cleanups.push(() => sessions.destroy());
    port.arrive(settingsFor(null));
    await settle();
    const host = document.createElement("div");
    host.contentEditable = "true";
    host.innerHTML = "<p>one</p>";
    document.body.appendChild(host);
    host.focus();
    keydownOn(host, "Escape");
    expect(hostCount()).toBe(1);
    host.contentEditable = "false";
    await settle();
    expect(hostCount()).toBe(0);
  });
});

describe("motions across lines", () => {
  it("j k w $ gg G and Enter land where they land in a textarea with the same text", async () => {
    const ta = document.createElement("textarea");
    ta.value = "the quick brown fox\njumps over the lazy dog\nthird line here";
    document.body.appendChild(ta);
    ta.setSelectionRange(0, 0);
    const taField = new TextareaField(ta);
    const taSession = new Session(taField, { vimrc: "" });
    cleanups.push(() => {
      taSession.destroy();
      taField.destroy();
    });
    const onTextarea = settledKeyDriver(() => taSession);
    const ce = open();
    ce.host.focus();
    for (const key of ["w", "w", "j", "$", "k", "j", "j", "w", "gg", "G", "k", "0", "Enter", "gg", "Enter"]) {
      for (const drive of [onTextarea, { keydown, keys }]) {
        if (key === "Enter") drive.keydown("Enter");
        else drive.keys(key);
      }
      expect(ce.field.getSelection(), `after ${key}`).toEqual(taField.getSelection());
    }
  });
});

describe("Normal-mode edits go through editing commands", () => {
  it("x dw cw dd J edit the blocks, each write a beforeinput and an input event of an editing type", async () => {
    const { host } = open();
    const log = inputLog(host);
    await keys("x");
    expect(blockTexts(host)[0]).toBe("he quick brown fox");
    await keys("dw");
    expect(blockTexts(host)[0]).toBe("quick brown fox");
    await keys("cw");
    typeNatively("slow");
    await keydown("Escape");
    expect(blockTexts(host)[0]).toBe("slow brown fox");
    await keys("jdd");
    expect(blockTexts(host)).toEqual(["slow brown fox", "third line here"]);
    await keys("ggJ");
    expect(blockTexts(host)).toEqual(["slow brown fox third line here"]);
    expect(log.length).toBeGreaterThan(0);
    expect(
      log.every((e) => /^(before|input):(insertText|deleteContentBackward|insertParagraph)$/.test(e)),
      log.join(),
    ).toBe(true);
  });

  it("o on a bare text line above a <div> (Gmail's compose body) opens a line, and typing lands on it (#67)", async () => {
    const { host } = open("one<div>two</div>");
    await keys("o");
    typeNatively("new");
    await keydown("Escape");
    // innerText reads a line more here than renders (projection-innertext.test.ts).
    expect(project(host).text).toBe("one\nnew\ntwo");
    expect(statusText()).not.toContain("refused");
    await keys("dd");
    expect(project(host).text).toBe("one\ntwo");
  });

  it("o and O open new blocks; a linewise p adds one", async () => {
    const { host } = open();
    await keys("o");
    typeNatively("below");
    await keydown("Escape");
    expect(blockTexts(host)).toEqual([
      "the quick brown fox",
      "below",
      "jumps over the lazy dog",
      "third line here",
    ]);
    await keys("GO");
    typeNatively("above");
    await keydown("Escape");
    expect(blockTexts(host)).toEqual([
      "the quick brown fox",
      "below",
      "jumps over the lazy dog",
      "above",
      "third line here",
    ]);
    await keys("ggyyGp");
    expect(blockTexts(host)).toEqual([
      "the quick brown fox",
      "below",
      "jumps over the lazy dog",
      "above",
      "third line here",
      "the quick brown fox",
    ]);
  });

  it("dd on a middle line and J merge blocks", async () => {
    const { host } = open();
    await keys("jdd");
    expect(blockTexts(host)).toEqual(["the quick brown fox", "third line here"]);
    await keys("kJ");
    expect(blockTexts(host)).toEqual(["the quick brown fox third line here"]);
  });

  it("u and Ctrl-r walk VimText's history and restore the text exactly", async () => {
    const { host, field } = open();
    const original = field.getValue();
    await keys("x");
    await keys("jdd");
    await keys("kJ");
    const edited = field.getValue();
    await keys("uuu");
    expect(field.getValue()).toBe(original);
    expect(blockTexts(host)).toEqual(["the quick brown fox", "jumps over the lazy dog", "third line here"]);
    await keydown("r", { ctrlKey: true });
    await keydown("r", { ctrlKey: true });
    await keydown("r", { ctrlKey: true });
    expect(field.getValue()).toBe(edited);
  });
});

describe("the page's edits", () => {
  it("typing in Insert re-projects the host", async () => {
    const { host } = open();
    await keys("A");
    typeNatively("!");
    await keydown("Escape");
    await keys("x");
    expect(blockTexts(host)[0]).toBe("the quick brown fox");
    await keys("u");
    expect(blockTexts(host)[0]).toBe("the quick brown fox!");
  });

  it("an outside DOM change is picked up on the next key", async () => {
    const { host } = open();
    host.children[1]!.textContent = "changed";
    await keys("j0x");
    expect(blockTexts(host)).toEqual(["the quick brown fox", "hanged", "third line here"]);
  });
});

describe("the Normal cursor", () => {
  it("is the native selection of the character under it", async () => {
    open();
    expect(selectedText()).toBe("t");
    await keys("w");
    expect(selectedText()).toBe("q");
    await keys("j");
    expect(selectedText()).toBe("s");
  });

  it("is a collapsed caret on an empty block", async () => {
    const { host } = open("<p>one</p><p><br></p><p>three</p>");
    await keys("j");
    expect(isCaretIn(host.children[1]!)).toBe(true);
  });
});

describe("Replace mode", () => {
  it("R overwrites characters in place, inside the bold run they were in; Esc and u bring the old text back", async () => {
    const { host } = open("<p>the <b>quick</b> brown fox</p><p>jumps</p>");
    await keys("wRQU");
    expect(statusText()).toContain("REPLACE");
    expect(host.querySelector("b")?.textContent).toBe("QUick");
    expect(blockTexts(host)).toEqual(["the QUick brown fox", "jumps"]);
    await keydown("Escape");
    await keys("u");
    expect(blockTexts(host)).toEqual(["the quick brown fox", "jumps"]);
  });
});

describe("Enter", () => {
  it("in Normal is the Vim motion, taken from the page", async () => {
    open();
    const e = await keydown("Enter");
    expect(e.defaultPrevented).toBe(true);
    expect(selectedText()).toBe("j");
  });

  it("with Cmd or Ctrl passes through to the page", async () => {
    open();
    expect((await keydown("Enter", { metaKey: true })).defaultPrevented).toBe(false);
    expect((await keydown("Enter", { ctrlKey: true })).defaultPrevented).toBe(false);
  });
});
