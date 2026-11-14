import { describe, it, expect, afterEach } from "vitest";
import { userEvent } from "@vitest/browser/context";
import { resolveField } from "../../src/field/resolve";
import { Session } from "../../src/bridge/Session";
import type { Field } from "../../src/field/Field";
import { blockTexts, caretAt, editableHost, inputLog } from "./contenteditable";
import { settledKeyDriver } from "./keys";
import { Sessions } from "../../src/content/Sessions";
import { hostCount, keydown as keydownOn, settle, statusText } from "./dom";
import { controlledPort, settingsFor } from "./settings-port";

/**
 * A contenteditable host that declares `aria-multiline="false"` is a
 * Single-line Field (#49, DESIGN.md "contenteditable Fields", _Single-line_):
 * it takes the same Single-line rules an input does. No other signal makes a
 * host single-line.
 */

let session: Session | null = null;
let field: Field | null = null;
let sessions: Sessions | null = null;

afterEach(() => {
  sessions?.destroy();
  sessions = null;
  session?.destroy();
  field?.destroy();
  session = field = null;
  document.body.innerHTML = "";
});

const { keydown, keys } = settledKeyDriver(() => session!);

const SINGLE_LINE = { attrs: { "aria-multiline": "false" } };

describe("which contenteditable is a Single-line Field", () => {
  it('a host with aria-multiline="false" is a Single-line Field', async () => {
    const field = resolveField(editableHost("<p>title</p>", SINGLE_LINE))!.create();
    expect(field.singleLine).toBe(true);
    field.destroy();
  });

  it.each<[string, Record<string, string>]>([
    ["no aria-multiline", {}],
    ['aria-multiline="true"', { "aria-multiline": "true" }],
    ['role="textbox"', { role: "textbox" }],
  ])("a host with %s is multi-line", (_, attrs) => {
    const host = editableHost("<p>title</p>", { attrs });
    host.style.height = "20px"; // one line tall: height is no signal either
    const field = resolveField(host)!.create();
    expect(field.singleLine).toBe(false);
    field.destroy();
  });
});

/** A Session on a host made as the content entry makes it (`resolveField`), caret at the start. */
function open(opts: Parameters<typeof editableHost>[1] = {}): HTMLElement {
  const host = editableHost("<p>hello world</p>", opts);
  host.focus();
  caretAt(host, 0);
  field = resolveField(host)!.create();
  session = new Session(field, { vimrc: "" });
  return host;
}

describe('Single-line rules on an aria-multiline="false" host', () => {
  it("Enter in plain Normal passes through to the page (it submits)", async () => {
    open(SINGLE_LINE);
    expect((await keydown("Enter")).defaultPrevented).toBe(false);
  });

  it("o and O beep: Normal stays, the text is unchanged, a pending count is cleared", async () => {
    const host = open(SINGLE_LINE);
    expect((await keydown("o")).defaultPrevented).toBe(true);
    expect(session!.mode).toBe("normal");
    await keys("3O");
    expect(session!.mode).toBe("normal");
    expect(blockTexts(host)).toEqual(["hello world"]);
    await keys("x");
    expect(blockTexts(host)).toEqual(["ello world"]); // not "lo world": the 3 went with the beep
  });

  it("yyp concatenates as on an input; one u restores", async () => {
    const host = open(SINGLE_LINE);
    await keys("yyp");
    expect(blockTexts(host)).toEqual(["hello worldhello world"]);
    await keys("u");
    expect(blockTexts(host)).toEqual(["hello world"]);
  });
});

/**
 * The browser's own edit for an Enter the page leaves alone (#51). The Session
 * here has no document listener, so a trusted Enter reaches the browser as a
 * row-6 Pass-through does; `userEvent` presses it through Playwright.
 */
describe("the browser's line break on a Single-line host", () => {
  it("outside Insert mode it is cancelled: w Enter leaves the text, x then deletes w", async () => {
    const host = open(SINGLE_LINE);
    await keys("w");
    await userEvent.keyboard("{Enter}");
    expect(blockTexts(host)).toEqual(["hello world"]);
    await keys("x");
    expect(blockTexts(host)).toEqual(["hello orld"]);
  });

  it("on a host inside an open shadow root it is cancelled too", async () => {
    const shadowHost = document.body.appendChild(document.createElement("div"));
    const root = shadowHost.attachShadow({ mode: "open" });
    const host = editableHost("<p>hello world</p>", { ...SINGLE_LINE, parent: root });
    host.focus();
    caretAt(host, 0);
    field = resolveField(host)!.create();
    session = new Session(field, { vimrc: "" });
    await keys("w");
    await userEvent.keyboard("{Enter}");
    expect(blockTexts(host)).toEqual(["hello world"]);
  });

  it.each(["i", "R"])("after %s (Insert, Replace) it stays the browser's", async (key) => {
    const host = open(SINGLE_LINE);
    const log = inputLog(host);
    await keys(key);
    await userEvent.keyboard("{Enter}");
    expect(log).toContain("input:insertParagraph");
  });

  it("on a multi-line host it stays the browser's", async () => {
    const host = open();
    const log = inputLog(host);
    await userEvent.keyboard("{Enter}");
    expect(log).toContain("input:insertParagraph");
  });

  it("once the Session is destroyed it stays the browser's", async () => {
    const host = open(SINGLE_LINE);
    const log = inputLog(host);
    session!.destroy();
    await userEvent.keyboard("{Enter}");
    expect(log).toContain("input:insertParagraph");
  });
});

describe("the same host without the attribute stays multi-line", () => {
  it("Enter is the Vim motion, o opens a line, yyp pastes a line below", async () => {
    const host = open();
    expect((await keydown("Enter")).defaultPrevented).toBe(true);
    await keys("yyp");
    expect(blockTexts(host)).toEqual(["hello world", "hello world"]);
    await keys("o");
    expect(session!.mode).toBe("insert");
    expect(blockTexts(host)).toEqual(["hello world", "hello world", ""]);
  });
});

describe("aria-multiline changing under a Session", () => {
  it.each([
    ['declared "false"', null, "false"],
    ["removed", "false", null],
  ])(
    "the Session ends when the attribute is %s, and the next Activation takes the new kind",
    async (_, before, after) => {
      const port = controlledPort();
      sessions = new Sessions(document, port.port, location.origin);
      port.arrive(settingsFor(null));
      await settle();
      const host = editableHost("<p>hello world</p>", before ? { attrs: { "aria-multiline": before } } : {});
      host.focus();
      caretAt(host, 0);
      keydownOn(host, "Escape");
      expect(statusText()).toContain("NORMAL");
      if (after) host.setAttribute("aria-multiline", after);
      else host.removeAttribute("aria-multiline");
      await settle();
      expect(hostCount()).toBe(0);
      keydownOn(host, "Escape");
      expect(statusText()).toContain("NORMAL");
      expect(keydownOn(host, "Enter").defaultPrevented).toBe(after !== "false");
    },
  );
});
