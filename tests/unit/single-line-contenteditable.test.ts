import { describe, it, expect, afterEach } from "vitest";
import { resolveField } from "../../src/field/resolve";
import { Session } from "../../src/bridge/Session";
import type { Field } from "../../src/field/Field";
import { blockTexts, caretAt, editableHost } from "./contenteditable";
import { keyDriver } from "./keys";
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

const { keydown, keys } = keyDriver(() => session!);

const SINGLE_LINE = { attrs: { "aria-multiline": "false" } };

describe("which contenteditable is a Single-line Field", () => {
  it('a host with aria-multiline="false" is a Single-line Field', () => {
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
  it("Enter in plain Normal passes through to the page (it submits)", () => {
    open(SINGLE_LINE);
    expect(keydown("Enter").defaultPrevented).toBe(false);
  });

  it("o and O beep: Normal stays, the text is unchanged, a pending count is cleared", () => {
    const host = open(SINGLE_LINE);
    expect(keydown("o").defaultPrevented).toBe(true);
    expect(session!.mode).toBe("normal");
    keys("3O");
    expect(session!.mode).toBe("normal");
    expect(blockTexts(host)).toEqual(["hello world"]);
    keys("x");
    expect(blockTexts(host)).toEqual(["ello world"]); // not "lo world": the 3 went with the beep
  });

  it("yyp concatenates as on an input; one u restores", () => {
    const host = open(SINGLE_LINE);
    keys("yyp");
    expect(blockTexts(host)).toEqual(["hello worldhello world"]);
    keys("u");
    expect(blockTexts(host)).toEqual(["hello world"]);
  });
});

describe("the same host without the attribute stays multi-line", () => {
  it("Enter is the Vim motion, o opens a line, yyp pastes a line below", () => {
    const host = open();
    expect(keydown("Enter").defaultPrevented).toBe(true);
    keys("yyp");
    expect(blockTexts(host)).toEqual(["hello world", "hello world"]);
    keys("o");
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
