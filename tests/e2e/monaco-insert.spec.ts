import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, statusText } from "./extension";
import {
  MONACO_TEXT,
  focusMonaco,
  monacoHistory,
  monacoSelections,
  monacoText,
  openMonaco,
  pageKeys,
  setMonacoSetting,
  tokensReady,
} from "./monaco";

// Insert on the Monaco Field (#120; ADR 0010): Monaco does the typing, what it
// wrote is in the mirror by the next key VimText takes, as the Field's own
// typing, and one Esc closes a suggestion popup and goes to Normal. The mirror
// is not read: what it holds shows in what the next Vim command does to the
// text Monaco holds. In both projects, so on both input kinds. The Monaco
// facts under these cases are pinned in tests/e2e/monaco-facts.spec.ts
// ("Monaco: the suggestion popup", "Monaco: bracket closing").

const LINES = MONACO_TEXT.split("\n");
/** The end of the first line, "function add(a, b) {". */
const LINE_1_END = LINES[0]!.length;
/** The text's end, on its last line, which is empty: the start of a word typed there opens a suggestion popup. */
const TEXT_END = MONACO_TEXT.length;
const POPUP = "#editor .suggest-widget.visible";

/** The fixture's text with `lines` after its first line. */
function afterFirstLine(...lines: string[]): string {
  return [LINES[0], ...lines, ...LINES.slice(1)].join("\n");
}

/** What Monaco makes of Enter, `bar(` and `x` typed at the first line's end: an indented line with the bracket closed. */
const TYPED_LINE = "  bar(x)";
const WITH_TYPED_LINE = afterFirstLine(TYPED_LINE);

async function typeLine(page: Page): Promise<void> {
  await page.keyboard.press("Enter");
  // Monaco closes no bracket on a line just made until it has the tokens above it.
  await tokensReady(page);
  await page.keyboard.type("bar(x");
}

/** Opens the fixture with the setting on and Activates the editor with Esc, the caret at `offset`. */
async function activate(page: Page, context: BrowserContext, offset: number): Promise<void> {
  await setMonacoSetting(context, true);
  await openMonaco(page);
  await focusMonaco(page, offset);
  await page.keyboard.press("Escape");
  await expect.poll(() => statusText(page)).toContain("NORMAL");
}

async function escToNormal(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect.poll(() => statusText(page)).toContain("NORMAL");
}

/** `key` from Normal, into Insert. */
async function insertWith(page: Page, key: string): Promise<void> {
  await page.keyboard.type(key);
  await expect.poll(() => statusText(page)).toContain("INSERT");
}

/** Activates at the first line's end and appends there: Enter, `bar(`, `x`, then Esc. */
async function insertLine(page: Page, context: BrowserContext): Promise<void> {
  await activate(page, context, LINE_1_END);
  await insertWith(page, "a");
  await typeLine(page);
  await escToNormal(page);
}

test.describe("in Insert, Monaco does the typing", () => {
  test("( leaves () and Enter indents, the text the same with the setting on as with it off", async ({
    page,
    context,
  }) => {
    await setMonacoSetting(context, false);
    await openMonaco(page);
    await focusMonaco(page, LINE_1_END);
    await typeLine(page);
    const off = await monacoText(page);
    expect(off).toBe(WITH_TYPED_LINE);

    await insertLine(page, context);
    expect(await monacoText(page)).toBe(off);
  });

  test("{ and Enter give Monaco's three lines, the same with the setting on as with it off", async ({
    page,
    context,
  }) => {
    const keys = async () => {
      await page.keyboard.type("{");
      await page.keyboard.press("Enter");
      await page.keyboard.type("y");
    };
    await setMonacoSetting(context, false);
    await openMonaco(page);
    await focusMonaco(page, TEXT_END);
    await keys();
    const off = await monacoText(page);
    expect(off).toBe(MONACO_TEXT + "{\n  y\n}");

    await activate(page, context, TEXT_END);
    await insertWith(page, "i");
    await keys();
    await escToNormal(page);
    expect(await monacoText(page)).toBe(off);
  });

  test("the keys typed in Insert reach the page, and the Esc that leaves Insert does not", async ({
    page,
    context,
  }) => {
    await insertLine(page, context);
    // The Activating Esc and `a` are VimText's too.
    expect(await pageKeys(page)).toEqual(["Enter", "b", "a", "r", "(", "x"]);
  });
});

test.describe("what Monaco wrote in Insert is the Field's own typing", () => {
  test("Esc leaves the Cursor on the character typed last, and x deletes it", async ({ page, context }) => {
    await insertLine(page, context);
    const x = WITH_TYPED_LINE.indexOf("x)");
    expect(await monacoSelections(page)).toEqual([{ anchor: x, head: x }]);
    await page.keyboard.type("x");
    expect(await monacoText(page)).toBe(afterFirstLine("  bar()"));
  });

  test("dd after the Insert deletes the line as Monaco wrote it, and u puts that line back", async ({
    page,
    context,
  }) => {
    await insertLine(page, context);
    await page.keyboard.type("dd");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(WITH_TYPED_LINE);
  });

  test("u removes everything the Insert added, Monaco's indent and bracket included, in one step; Ctrl-r restores it", async ({
    page,
    context,
  }) => {
    await insertLine(page, context);
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
    await page.keyboard.press("Control+r");
    expect(await monacoText(page)).toBe(WITH_TYPED_LINE);
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
  });

  test("u after an Insert takes back that Insert alone, not the Vim change before it", async ({
    page,
    context,
  }) => {
    await activate(page, context, 0);
    await page.keyboard.type("x");
    await insertWith(page, "A");
    await typeLine(page);
    await escToNormal(page);
    const typed = [LINES[0]!.slice(1), TYPED_LINE, ...LINES.slice(1)].join("\n");
    expect(await monacoText(page)).toBe(typed);
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(MONACO_TEXT.slice(1));
    // u wrote the Insert's removal as a step of Monaco's undo stack: Monaco's own undo takes that back.
    await monacoHistory(page, "undo");
    expect(await monacoText(page)).toBe(typed);
  });

  test("Ctrl-w in Insert deletes the word before the caret as Monaco left it", async ({ page, context }) => {
    await activate(page, context, LINE_1_END);
    await insertWith(page, "a");
    await page.keyboard.type(" foo(bar");
    expect(await monacoText(page)).toBe(MONACO_TEXT.replace("{", "{ foo(bar)"));
    await page.keyboard.press("Control+w");
    expect(await monacoText(page)).toBe(MONACO_TEXT.replace("{", "{ foo()"));
    await expect.poll(() => statusText(page)).toContain("INSERT");
  });
});

test.describe("a suggestion popup", () => {
  /** Activates on the empty last line and types `re` in Insert: Monaco offers `return`. */
  async function openPopup(page: Page, context: BrowserContext): Promise<void> {
    await activate(page, context, TEXT_END);
    await insertWith(page, "i");
    await page.keyboard.type("re");
    await expect(page.locator(POPUP)).toHaveCount(1);
  }

  test("one Esc closes it and the Status Line shows Normal; the page does not see that Esc", async ({
    page,
    context,
  }) => {
    await openPopup(page, context);
    await page.keyboard.press("Escape");
    await expect.poll(() => statusText(page)).toContain("NORMAL");
    await expect(page.locator(POPUP)).toHaveCount(0);
    expect(await pageKeys(page)).toEqual(["r", "e"]);
    expect(await monacoText(page)).toBe(MONACO_TEXT + "re");
  });

  test("one Esc closes a popup asked for on an empty line, where Esc does not move the Cursor", async ({
    page,
    context,
  }) => {
    await activate(page, context, TEXT_END);
    await insertWith(page, "i");
    await page.keyboard.press("Control+Space");
    await expect(page.locator(POPUP)).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect.poll(() => statusText(page)).toContain("NORMAL");
    await expect(page.locator(POPUP)).toHaveCount(0);
    expect(await monacoText(page)).toBe(MONACO_TEXT);
  });

  test("Ctrl-[ closes it as Esc does", async ({ page, context }) => {
    await openPopup(page, context);
    await page.keyboard.press("Control+[");
    await expect.poll(() => statusText(page)).toContain("NORMAL");
    await expect(page.locator(POPUP)).toHaveCount(0);
  });

  test("the Activating Esc closes one opened before VimText was Activated", async ({ page, context }) => {
    await setMonacoSetting(context, true);
    await openMonaco(page);
    await focusMonaco(page, TEXT_END);
    // Asked for on an empty line, where the Activating Esc does not move the caret.
    await page.keyboard.press("Control+Space");
    await expect(page.locator(POPUP)).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect.poll(() => statusText(page)).toContain("NORMAL");
    await expect(page.locator(POPUP)).toHaveCount(0);
  });

  test("an accepted suggestion is in the engine's text after Esc: 0x deletes its first character, and u u takes back the x, then the Insert", async ({
    page,
    context,
  }) => {
    await openPopup(page, context);
    await page.keyboard.press("Enter");
    expect(await monacoText(page)).toBe(MONACO_TEXT + "return");
    await escToNormal(page);
    await page.keyboard.type("0x");
    expect(await monacoText(page)).toBe(MONACO_TEXT + "eturn");
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(MONACO_TEXT + "return");
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
  });
});

test.describe("Monaco's own undo in Insert", () => {
  test("Cmd/Ctrl+Z in Insert undoes Monaco's last edit, and the Vim commands after it act on that text", async ({
    page,
    context,
  }) => {
    await activate(page, context, LINE_1_END);
    await insertWith(page, "a");
    await page.keyboard.type("(x");
    expect(await monacoText(page)).toBe(MONACO_TEXT.replace("{", "{(x)"));
    await page.keyboard.press("ControlOrMeta+z");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
    await expect.poll(() => statusText(page)).toContain("INSERT");
    await page.keyboard.type("y");
    await escToNormal(page);
    expect(await monacoText(page)).toBe(MONACO_TEXT.replace("{", "{y"));
    // The Cursor is on the "y": x deletes it, u brings it back, and u again takes the Insert back.
    await page.keyboard.type("x");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(MONACO_TEXT.replace("{", "{y"));
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
  });

  test("Cmd/Ctrl+Z as the Insert's last key: u in Normal has nothing of that Insert to undo", async ({
    page,
    context,
  }) => {
    await activate(page, context, 0);
    await page.keyboard.type("x");
    await insertWith(page, "A");
    await page.keyboard.type("(x");
    await page.keyboard.press("ControlOrMeta+z");
    await escToNormal(page);
    expect(await monacoText(page)).toBe(MONACO_TEXT.slice(1));
    // The step before the Insert is the x.
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
  });
});

test.describe(". after an Insert that Monaco added to", () => {
  test(". repeats the text the Insert left, Monaco's closed bracket in it as text: nothing is typed around or closed again", async ({
    page,
    context,
  }) => {
    await activate(page, context, LINE_1_END);
    await insertWith(page, "a");
    await page.keyboard.type("(x");
    await escToNormal(page);
    expect(await monacoText(page)).toBe(MONACO_TEXT.replace("{", "{(x)"));
    // On the third line, "}": `.` appends after it.
    await page.keyboard.type("jj.");
    const repeated = [LINES[0] + "(x)", LINES[1], "}(x)", ...LINES.slice(3)].join("\n");
    expect(await monacoText(page)).toBe(repeated);
    // The Cursor is where the Insert's Esc would have left it, on the "x".
    const x = repeated.indexOf("}(x)") + 2;
    expect(await monacoSelections(page)).toEqual([{ anchor: x, head: x }]);
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(MONACO_TEXT.replace("{", "{(x)"));
  });

  test(". repeats Monaco's indent as the spaces it was, not as an indent for the new place", async ({
    page,
    context,
  }) => {
    await insertLine(page, context);
    // On the fourth line of the fixture's text, "}", at no indent: Monaco's own Enter there adds none.
    await page.keyboard.type("jj.");
    expect(await monacoText(page)).toBe(
      [LINES[0], TYPED_LINE, LINES[1], LINES[2], TYPED_LINE, ...LINES.slice(3)].join("\n"),
    );
  });

  test(". after an Insert that wrote in two places repeats everything from the first to the last, the text between included", async ({
    page,
    context,
  }) => {
    await activate(page, context, 0);
    await insertWith(page, "A");
    await page.keyboard.type("y");
    // The caret put at the line's start, as a click does.
    await focusMonaco(page, 0);
    await page.keyboard.type("z");
    await escToNormal(page);
    const first = "z" + LINES[0] + "y";
    expect(await monacoText(page)).toBe([first, ...LINES.slice(1)].join("\n"));
    await page.keyboard.type("j.");
    expect(await monacoText(page)).toBe([first, LINES[1] + first, ...LINES.slice(2)].join("\n"));
    // One Insert, one undo step: the repeat, then both places of the Insert.
    await page.keyboard.type("uu");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
  });
});
