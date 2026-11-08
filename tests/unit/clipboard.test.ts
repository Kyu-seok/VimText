import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TextareaField } from "../../src/field/TextareaField";
import { Session } from "../../src/bridge/Session";
import { keyDriver } from "./keys";
import { statusText } from "./dom";

/**
 * The clipboard registers (DESIGN.md "Registers & clipboard"): `"*` is an
 * alias of `"+`, a key rewrite in the bridge; the engine writes the clipboard
 * on a `"+` yank and reads it on a `"+` paste. Observed from outside through a
 * stubbed `navigator.clipboard` (the unit suite's page has no clipboard
 * permission): what a yank leaves there, what a paste takes from it, and what
 * the user sees when the read is denied or there is no clipboard at all.
 * Coverage (rule 5): the rewrite is made inside the Session, so placement is
 * the Sessions class's concern, not this file's. Modes: Normal and Visual on a
 * textarea, Insert through `Ctrl-r`; Normal on a Single-line Field.
 */

let ta: HTMLTextAreaElement;
let field: TextareaField;
let session: Session;
/** The stubbed system clipboard's text. */
let clipboard: string;
let readText: () => Promise<string>;

const { keydown, keys } = keyDriver(() => session);

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

  it('Visual "*y puts the selection on the clipboard', () => {
    keys('vee"*y');
    expect(clipboard).toBe("the quick");
  });

  it('on a Single-line Field "*yiw then "+P round-trips too', async () => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = "hello world";
    document.body.appendChild(input);
    input.focus();
    input.setSelectionRange(0, 0);
    const singleField = new TextareaField(input);
    const single = new Session(singleField, { vimrc: "" });
    const drive = keyDriver(() => single);
    try {
      drive.keys('"*yiw');
      expect(clipboard).toBe("hello");
      clipboard = "HELLO";
      drive.keys('"+P');
      await expect.poll(() => input.value).toBe("HELLOhello world");
    } finally {
      single.destroy();
      singleField.destroy();
      input.remove();
    }
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

describe("Without a clipboard API (a plain http page: insecure context)", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
  });

  it('"+p says so on the Status Line and leaves the text', async () => {
    keys('"+p');
    await expect.poll(() => statusText()).toContain("clipboard");
    expect(ta.value).toMatch(/^the quick brown fox\n/);
  });

  it('"+y says so too and is not an engine error; the next key is a plain one', () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    keys('"+y');
    expect(statusText()).toContain("clipboard");
    expect(errors).not.toHaveBeenCalled();
    keys("x");
    expect(ta.value).toMatch(/^he quick/);
  });
});
