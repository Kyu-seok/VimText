import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, setSettings, statusText } from "./extension";
import { fixtureOrigin } from "./fixture-port";
import {
  MONACO_TEXT,
  focusMonaco,
  monacoCursorLine,
  monacoCursorStyle,
  monacoSelections,
  monacoText,
  openMonaco,
  setMonacoSetting,
  tallText,
  withEditor,
} from "./monaco";

// How a Monaco Field shows its Mode (#118; ADR 0010): Normal as Monaco's block
// cursor style, Visual as Monaco's own selection, the view following the
// Cursor, one cursor after a command. Read through the editor, as the other
// Monaco specs do; in both projects, so on both input kinds.

const LINES = MONACO_TEXT.split("\n");

interface Opening {
  offset?: number;
  /** Run in the page before the editor takes focus: the page's own setup of its editor. */
  before?: () => Promise<unknown>;
}

/** Opens the fixture with the setting on and Activates the editor with Esc. */
async function activate(
  page: Page,
  context: BrowserContext,
  { offset = 0, before }: Opening = {},
): Promise<void> {
  await setMonacoSetting(context, true);
  await openMonaco(page);
  await before?.();
  await focusMonaco(page, offset);
  await page.keyboard.press("Escape");
  await expect.poll(() => statusText(page)).toContain("NORMAL");
}

/** The class of the layer Monaco draws its cursors in, which names the style drawn. */
function cursorsLayer(page: Page): Promise<string> {
  return page.locator("#editor .cursors-layer").evaluate((el) => el.className);
}

test.describe("Normal shows as Monaco's block cursor, Insert as the style the page had", () => {
  test("Normal: a block on the Cursor's character with nothing selected; i: the line style; Esc: the block again", async ({
    page,
    context,
  }) => {
    await activate(page, context, { offset: 9 });
    expect(await monacoCursorStyle(page)).toBe("Block");
    expect(await cursorsLayer(page)).toContain("cursor-block-style");
    expect(await monacoSelections(page)).toEqual([{ anchor: 9, head: 9 }]);
    await page.keyboard.type("l");
    expect(await monacoSelections(page)).toEqual([{ anchor: 10, head: 10 }]);
    await page.keyboard.type("i");
    await expect.poll(() => statusText(page)).toContain("INSERT");
    expect(await monacoCursorStyle(page)).toBe("Line");
    expect(await cursorsLayer(page)).toContain("cursor-line-style");
    await page.keyboard.press("Escape");
    await expect.poll(() => statusText(page)).toContain("NORMAL");
    expect(await monacoCursorStyle(page)).toBe("Block");
  });

  test("a page that set the underline style gets it back in Insert", async ({ page, context }) => {
    await activate(page, context, {
      before: () => withEditor(page, (ed) => ed.updateOptions({ cursorStyle: "underline" }), null),
    });
    expect(await monacoCursorStyle(page)).toBe("Block");
    await page.keyboard.type("a");
    await expect.poll(() => statusText(page)).toContain("INSERT");
    expect(await monacoCursorStyle(page)).toBe("Underline");
    await page.keyboard.press("Escape");
    await expect.poll(() => statusText(page)).toContain("NORMAL");
    expect(await monacoCursorStyle(page)).toBe("Block");
  });

  test("Replace, the open command line and Visual show the page's style: R, : and v from Normal", async ({
    page,
    context,
  }) => {
    await activate(page, context);
    await page.keyboard.type(":");
    await expect.poll(() => monacoCursorStyle(page)).toBe("Line");
    await page.keyboard.press("Escape");
    await expect.poll(() => monacoCursorStyle(page)).toBe("Block");
    await page.keyboard.type("R");
    await expect.poll(() => statusText(page)).toContain("REPLACE");
    expect(await monacoCursorStyle(page)).toBe("Line");
    await page.keyboard.press("Escape");
    await expect.poll(() => statusText(page)).toContain("NORMAL");
    expect(await monacoCursorStyle(page)).toBe("Block");
    await page.keyboard.type("v");
    await expect.poll(() => statusText(page)).toContain("VISUAL");
    expect(await monacoCursorStyle(page)).toBe("Line");
  });
});

test.describe("the page's cursor style is back when the Session hides or ends", () => {
  const underline = (page: Page) => () =>
    withEditor(page, (ed) => ed.updateOptions({ cursorStyle: "underline" }), null);

  test("blur from Normal, and the block again on focus", async ({ page, context }) => {
    await activate(page, context, { before: underline(page) });
    expect(await monacoCursorStyle(page)).toBe("Block");
    await page.locator("#plain").focus();
    await expect.poll(() => monacoCursorStyle(page)).toBe("Underline");
    await withEditor(page, (ed) => ed.focus(), null);
    await expect.poll(() => monacoCursorStyle(page)).toBe("Block");
  });

  const endings: [string, (context: BrowserContext) => Promise<void>][] = [
    ["the setting switched off", (context) => setMonacoSetting(context, false)],
    ["Site Policy off", (context) => setMonacoSetting(context, true, { sites: { [fixtureOrigin]: "off" } })],
    [
      "the global switch off",
      (context) => setSettings(context, { enabled: false, sites: {}, vimrc: "", plugins: {}, monaco: true }),
    ],
  ];
  for (const [name, end] of endings) {
    test(`${name}, from Normal: the page's style, no Status Line, and keys are Monaco's again`, async ({
      page,
      context,
    }) => {
      await activate(page, context, { before: underline(page) });
      expect(await monacoCursorStyle(page)).toBe("Block");
      await end(context);
      await page.bringToFront();
      await expect.poll(() => monacoCursorStyle(page)).toBe("Underline");
      await expect.poll(() => statusText(page)).toBe("");
      await page.keyboard.type("x");
      expect(await monacoText(page)).toBe("x" + MONACO_TEXT);
    });
  }
});

test.describe("Visual shows as Monaco's own selection", () => {
  test("v with a motion selects what the engine selects, and d deletes exactly that", async ({
    page,
    context,
  }) => {
    await activate(page, context);
    await page.keyboard.type("ve");
    await expect.poll(() => statusText(page)).toContain("VISUAL");
    // "function": the Cursor's character is part of a Visual selection.
    expect(await monacoSelections(page)).toEqual([{ anchor: 0, head: 8 }]);
    await page.keyboard.type("d");
    expect(await monacoText(page)).toBe(MONACO_TEXT.slice(8));
    expect(await monacoSelections(page)).toEqual([{ anchor: 0, head: 0 }]);
    expect(await monacoCursorStyle(page)).toBe("Block");
  });

  test("a Visual selection made backwards has its head at the start", async ({ page, context }) => {
    await activate(page, context, { offset: 11 });
    await page.keyboard.type("vb");
    // From the "d" of "add" back over "function add" to the "a": offsets 9 to 12.
    expect(await monacoSelections(page)).toEqual([{ anchor: 12, head: 9 }]);
    await page.keyboard.type("d");
    expect(await monacoText(page)).toBe("function (a, b) {" + MONACO_TEXT.slice(LINES[0]!.length));
  });

  test("V with j selects the two lines whole, and d deletes them", async ({ page, context }) => {
    await activate(page, context, { offset: 5 });
    await page.keyboard.type("Vj");
    await expect.poll(() => statusText(page)).toContain("VISUAL LINE");
    const [selection] = await monacoSelections(page);
    expect(MONACO_TEXT.slice(selection!.anchor, selection!.head)).toBe(LINES.slice(0, 2).join("\n"));
    await page.keyboard.type("d");
    expect(await monacoText(page)).toBe(LINES.slice(2).join("\n"));
  });
});

test.describe("the view follows the Cursor on a text taller than the editor", () => {
  const tall = (page: Page) => () => withEditor(page, (ed, text) => ed.setValue(text), tallText(300));

  test("G, gg, Ctrl-d, Ctrl-u and a search each leave the Cursor's line in view", async ({
    page,
    context,
  }) => {
    await activate(page, context, { before: tall(page) });
    expect(await monacoCursorLine(page)).toEqual({ line: 1, inView: true });

    await page.keyboard.type("G");
    await expect.poll(() => monacoCursorLine(page)).toEqual({ line: 300, inView: true });

    await page.keyboard.type("gg");
    await expect.poll(() => monacoCursorLine(page)).toEqual({ line: 1, inView: true });

    // Each Ctrl-d moves the Cursor half a view down: four of them are past the first view.
    for (let i = 0; i < 4; i++) await page.keyboard.press("Control+d");
    await expect.poll(async () => (await monacoCursorLine(page)).inView).toBe(true);
    const down = (await monacoCursorLine(page)).line;
    expect(down).toBeGreaterThan(14);

    await page.keyboard.type("G");
    await expect.poll(() => monacoCursorLine(page)).toEqual({ line: 300, inView: true });
    for (let i = 0; i < 4; i++) await page.keyboard.press("Control+u");
    await expect.poll(async () => (await monacoCursorLine(page)).inView).toBe(true);
    expect((await monacoCursorLine(page)).line).toBeLessThan(286);

    await page.keyboard.type("/line 150");
    await page.keyboard.press("Enter");
    await expect.poll(() => monacoCursorLine(page)).toEqual({ line: 150, inView: true });
    expect(await monacoText(page)).toBe(tallText(300));
  });
});

test.describe("a Vim command acts on the primary cursor and leaves one", () => {
  test("with two Monaco cursors, x deletes at the primary one and one cursor remains", async ({
    page,
    context,
  }) => {
    await activate(page, context);
    // The primary cursor on the second line's "r", an extra one on the first line.
    await withEditor(
      page,
      (ed) =>
        ed.setSelections([
          { selectionStartLineNumber: 2, selectionStartColumn: 3, positionLineNumber: 2, positionColumn: 3 },
          { selectionStartLineNumber: 1, selectionStartColumn: 1, positionLineNumber: 1, positionColumn: 1 },
        ]),
      null,
    );
    expect(await monacoSelections(page)).toHaveLength(2);
    await page.keyboard.type("x");
    expect(await monacoText(page)).toBe([LINES[0], "  eturn a + b;", ...LINES.slice(2)].join("\n"));
    expect(await monacoSelections(page)).toEqual([{ anchor: 23, head: 23 }]);
  });

  test("a motion alone leaves one cursor too", async ({ page, context }) => {
    await activate(page, context);
    await withEditor(
      page,
      (ed) =>
        ed.setSelections([
          { selectionStartLineNumber: 1, selectionStartColumn: 1, positionLineNumber: 1, positionColumn: 1 },
          { selectionStartLineNumber: 2, selectionStartColumn: 1, positionLineNumber: 2, positionColumn: 1 },
        ]),
      null,
    );
    await page.keyboard.type("l");
    expect(await monacoSelections(page)).toEqual([{ anchor: 1, head: 1 }]);
  });
});
