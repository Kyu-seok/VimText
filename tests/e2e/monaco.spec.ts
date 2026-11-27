import { test, expect, statusText, hostCount } from "./extension";
import {
  MONACO_TEXT,
  focusMonaco,
  monacoHistory,
  monacoSelections,
  monacoText,
  openMonaco,
  pageKeys,
  setMonacoSetting,
} from "./monaco";

// The Monaco Field (ADR 0010, GLOSSARY.md) on the real Monaco package, against
// the built extension. The text and the selection are read through the editor
// (tests/e2e/monaco.ts), never the DOM. Each ticket of spec #115 has its own
// `describe` here or its own `monaco-*.spec.ts` beside this file; the shared
// helpers are in tests/e2e/monaco.ts.

const LINES = MONACO_TEXT.split("\n");
/** The fixture's text without its first line. */
const WITHOUT_LINE_1 = LINES.slice(1).join("\n");

/** Opens the fixture with the setting on and Activates the editor with Esc, the caret at `offset`. */
async function activate(
  page: import("@playwright/test").Page,
  context: import("@playwright/test").BrowserContext,
  offset = 0,
): Promise<void> {
  await setMonacoSetting(context, true);
  await openMonaco(page);
  await focusMonaco(page, offset);
  await page.keyboard.press("Escape");
  await expect.poll(() => statusText(page)).toContain("NORMAL");
}

test.describe("with the setting on, Normal-mode commands edit the code", () => {
  test("Esc shows the Status Line in Normal and the Vim keys do not reach the page", async ({
    page,
    context,
  }) => {
    await activate(page, context);
    await page.keyboard.type("x");
    expect(await monacoText(page)).toBe(MONACO_TEXT.slice(1));
    expect(await pageKeys(page)).toEqual([]);
  });

  test("the Status Line sits under the editor, across its width, not under Monaco's input at the caret", async ({
    page,
    context,
  }) => {
    await activate(page, context);
    const under = await page.locator("#editor .monaco-editor").evaluate((el) => {
      const r = el.getBoundingClientRect();
      const y = r.bottom + 8;
      return [r.left + 30, r.right - 30].map((x) => document.elementFromPoint(x, y)?.localName);
    });
    expect(under).toEqual(["vimtext-status", "vimtext-status"]);
  });

  test("x deletes the character under the Cursor and dd the line; u and Ctrl-r undo and redo each", async ({
    page,
    context,
  }) => {
    await activate(page, context);
    await page.keyboard.type("x");
    expect(await monacoText(page)).toBe(MONACO_TEXT.slice(1));
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
    await page.keyboard.type("dd");
    expect(await monacoText(page)).toBe(WITHOUT_LINE_1);
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
    await page.keyboard.press("Control+r");
    expect(await monacoText(page)).toBe(WITHOUT_LINE_1);
  });

  test("dd acts on the line Monaco's caret is on, and leaves Monaco's caret on the line that took its place", async ({
    page,
    context,
  }) => {
    // Offset 23: inside "  return a + b;", the second line.
    await activate(page, context, 23);
    await page.keyboard.type("dd");
    expect(await monacoText(page)).toBe([LINES[0], ...LINES.slice(2)].join("\n"));
    // The Cursor is on "}", which now starts at offset 21.
    expect((await monacoSelections(page))[0]!.anchor).toBe(21);
  });
});

test.describe("each Vim change is one step of Monaco's own undo stack", () => {
  test("two Vim changes are undone one at a time by Monaco's undo", async ({ page, context }) => {
    await activate(page, context);
    await page.keyboard.type("x");
    await page.keyboard.type("dd");
    expect(await monacoText(page)).toBe(WITHOUT_LINE_1);
    await monacoHistory(page, "undo");
    expect(await monacoText(page)).toBe(MONACO_TEXT.slice(1));
    await monacoHistory(page, "undo");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
  });

  test("a Vim change after typed text does not undo with the typing", async ({ page, context }) => {
    await setMonacoSetting(context, true);
    await openMonaco(page);
    await focusMonaco(page);
    await page.keyboard.type("ab");
    await page.keyboard.press("Escape");
    await expect.poll(() => statusText(page)).toContain("NORMAL");
    // The Activating Esc leaves the Cursor where the caret was: on "f", after the typed text.
    await page.keyboard.type("x");
    expect(await monacoText(page)).toBe("ab" + MONACO_TEXT.slice(1));
    await monacoHistory(page, "undo");
    expect(await monacoText(page)).toBe("ab" + MONACO_TEXT);
  });
});

test.describe("where the Monaco Field is refused, VimText stands down as 0.4.3 does", () => {
  /** Esc, then `dd`, with the caret at the start: no Status Line, and Monaco types the keys. */
  async function expectStoodDown(page: import("@playwright/test").Page, editor = 0): Promise<void> {
    await focusMonaco(page, 0, editor);
    await page.keyboard.press("Escape");
    await page.keyboard.type("dd");
    expect(await monacoText(page, editor)).toBe("dd" + MONACO_TEXT);
    expect(await pageKeys(page)).toEqual(["Escape", "d", "d"]);
    expect(await statusText(page)).toBe("");
    expect(await hostCount(page)).toBe(0);
  }

  test("setting off: no Status Line, and every key reaches the page", async ({ page, context }) => {
    await setMonacoSetting(context, false);
    await openMonaco(page);
    await expectStoodDown(page);
  });

  test("a fresh profile has the setting off", async ({ page }) => {
    await openMonaco(page);
    await expectStoodDown(page);
  });

  test("setting on, on a page without window.monaco: not a Field", async ({ page, context }) => {
    await setMonacoSetting(context, true);
    await openMonaco(page, { expose: false });
    await expectStoodDown(page);
  });

  test("setting on, a diff editor's modified side: not a Field", async ({ page, context }) => {
    await setMonacoSetting(context, true);
    await openMonaco(page, { diff: true });
    await expectStoodDown(page, 1);
  });

  test("setting on, a read-only editor: not a Field, and the text stays", async ({ page, context }) => {
    await setMonacoSetting(context, true);
    await openMonaco(page, { readOnly: true });
    await focusMonaco(page);
    await page.keyboard.press("Escape");
    await page.keyboard.type("dd");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
    expect(await pageKeys(page)).toEqual(["Escape", "d", "d"]);
    expect(await hostCount(page)).toBe(0);
  });

  test("setting on: a plain textarea beside the editor is still a textarea Field", async ({
    page,
    context,
  }) => {
    await setMonacoSetting(context, true);
    await openMonaco(page);
    await page.locator("#plain").focus();
    await page.keyboard.press("Escape");
    await expect.poll(() => statusText(page)).toContain("NORMAL");
    await page.keyboard.type("0x");
    await expect(page.locator("#plain")).toHaveValue(" plain textarea");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
  });
});

test.describe("a model with CRLF line ends", () => {
  test("dd on the second line deletes that line and keeps the other line ends", async ({ page, context }) => {
    await setMonacoSetting(context, true);
    await openMonaco(page, { eol: "crlf" });
    // Monaco's offset 24: inside the second line, past the first line's \r\n.
    await focusMonaco(page, 24);
    await page.keyboard.press("Escape");
    await expect.poll(() => statusText(page)).toContain("NORMAL");
    await page.keyboard.type("dd");
    expect(await monacoText(page)).toBe([LINES[0], ...LINES.slice(2)].join("\r\n"));
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(LINES.join("\r\n"));
  });
});
