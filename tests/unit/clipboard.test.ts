import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TextareaField } from "../../src/field/TextareaField";
import { Session } from "../../src/bridge/Session";
import { keyDriver } from "./keys";

/**
 * The clipboard registers (DESIGN.md "Registers & clipboard"): `"*` is an
 * alias of `"+`, a key rewrite in the bridge; the engine writes the clipboard
 * on a `"+` yank and reads it on a `"+` paste. Observed from outside through a
 * stubbed `navigator.clipboard` (the unit suite's page has no clipboard
 * permission): what a yank leaves there, what a paste takes from it, and what
 * the user sees when the read is denied. Coverage: Normal on a textarea; the
 * register prefix is the same key in Visual, and Insert's `Ctrl-r` takes a
 * register through the same rewrite.
 */

let ta: HTMLTextAreaElement;
let field: TextareaField;
let session: Session;
/** The stubbed system clipboard's text. */
let clipboard: string;
let readText: () => Promise<string>;

const { keydown, keys } = keyDriver(() => session);

/** What the user sees on the Status Line, "" when it is hidden. */
function statusText(): string {
  const host = document.querySelector("vimtext-status") as HTMLElement | null;
  const bar = host?.shadowRoot?.querySelector(".bar");
  return bar && host!.style.display !== "none" ? (bar.textContent ?? "") : "";
}

beforeEach(() => {
  clipboard = "";
  readText = () => Promise.resolve(clipboard);
  vi.stubGlobal("navigator", {
    ...navigator,
    clipboard: {
      writeText: (text: string) => {
        clipboard = text;
        return Promise.resolve();
      },
      readText: () => readText(),
    },
  });
  ta = document.createElement("textarea");
  ta.value = "the quick brown fox\njumps over the lazy dog";
  ta.style.cssText = "width:400px;height:120px;font:14px/1.4 monospace";
  document.body.appendChild(ta);
  ta.focus();
  ta.setSelectionRange(0, 0);
  field = new TextareaField(ta);
  session = new Session(field, { vimrc: "" });
});

afterEach(() => {
  session.destroy();
  field.destroy();
  ta.remove();
  vi.unstubAllGlobals();
});

describe("Clipboard registers", () => {
  it('"*yiw puts the word on the clipboard and "+p pastes it back', async () => {
    keys('"*yiw');
    expect(clipboard).toBe("the");
    clipboard = "THE";
    keys('"+p');
    await expect.poll(() => ta.value).toMatch(/^tTHEhe quick/);
  });

  it('"+yiw puts the word on the clipboard and "*p pastes it back', async () => {
    keys('"+yiw');
    expect(clipboard).toBe("the");
    clipboard = "THE";
    keys('"*p');
    await expect.poll(() => ta.value).toMatch(/^tTHEhe quick/);
  });

  it("Insert-mode Ctrl-r * takes the clipboard register, as Ctrl-r + does", () => {
    keys('"*yiw');
    keys("A");
    keydown("r", { ctrlKey: true });
    expect(keydown("*").defaultPrevented).toBe(true);
    expect(ta.value).toMatch(/^the quick brown foxthe\n/);
  });

  it("a denied clipboard read leaves the text as it was and says so on the Status Line", async () => {
    readText = () => Promise.reject(new DOMException("Read permission denied.", "NotAllowedError"));
    keys('"+p');
    await expect.poll(() => statusText()).toContain("clipboard");
    expect(ta.value).toMatch(/^the quick brown fox\n/);
    // The pending register is dropped: the next key is a plain one.
    keys("x");
    expect(ta.value).toMatch(/^he quick/);
  });
});
