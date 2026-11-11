import { describe, it, expect, afterEach } from "vitest";
import { Session } from "../../src/bridge/Session";
import { TextareaField } from "../../src/field/TextareaField";
import { Sessions } from "../../src/content/Sessions";
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
 * contenteditable host in the document. A host in an open shadow root is
 * `contenteditable-shadow.test.ts` (#50).
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
