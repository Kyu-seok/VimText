import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, extensionId, hostCount, setSettings, statusText } from "./extension";
import { fixtureOrigin } from "./fixture-port";
import {
  MONACO_TEXT,
  ONE_LINE_TEXT,
  SECOND_TEXT,
  changeFromOutside,
  focusMonaco,
  monacoCursorStyle,
  monacoSelections,
  monacoText,
  openMonaco,
  setMonacoSetting,
  shownStatusText,
  withEditor,
  type MonacoPage,
} from "./monaco";

// The Monaco Field under change (#121; ADR 0010): the page changing the text,
// the language or the model under a Session, several editors on one page, and
// the Session's lifecycle in every Mode. Read through the editor, as the other
// Monaco specs do; in both projects, so on both input kinds.
//
// The fixture's text, with the offset each line starts at:
//    0  function add(a, b) {
//   21    return a + b;
//   37  }
//   39
//   40  function twice(n) {
//   60    return add(n, n);
//   80  }
//   82

const LINES = MONACO_TEXT.split("\n");

/** Opens the fixture with the setting on and Activates its first editor with Esc, the caret at `offset`. */
async function activate(
  page: Page,
  context: BrowserContext,
  offset = 0,
  options: MonacoPage = {},
): Promise<void> {
  await setMonacoSetting(context, true);
  await openMonaco(page, options);
  await focusMonaco(page, offset);
  await page.keyboard.press("Escape");
  await expect.poll(() => statusText(page)).toContain("NORMAL");
}

/** A text the page puts in place of the fixture's: its first line the same, the rest another function body. */
const NEW_TEXT = [LINES[0], "  return 0;", "}", ""].join("\n");

test.describe("the page replaces the whole text, as a reset button does", () => {
  test("in Normal: the next Vim command acts on the new text", async ({ page, context }) => {
    await activate(page, context, 21);
    await page.keyboard.type("x");
    await changeFromOutside(page, { kind: "replace", text: NEW_TEXT });
    await page.keyboard.type("ggdd");
    expect(await monacoText(page)).toBe("  return 0;\n}\n");
    await expect.poll(() => statusText(page)).toContain("NORMAL");
  });

  test("in Insert: Esc and a Vim command act on the new text", async ({ page, context }) => {
    await activate(page, context);
    await page.keyboard.type("ixy");
    expect(await monacoText(page)).toBe("xy" + MONACO_TEXT);
    await changeFromOutside(page, { kind: "replace", text: NEW_TEXT });
    await page.keyboard.press("Escape");
    await expect.poll(() => statusText(page)).toContain("NORMAL");
    await page.keyboard.type("Gdd");
    expect(await monacoText(page)).toBe([LINES[0], "  return 0;", "}"].join("\n"));
  });
});

test.describe("the page flushes the model or changes its language: no undo back, no marks kept", () => {
  /** The fixture's text after `x` on the "a" of "add". */
  const AFTER_X = "function dd" + MONACO_TEXT.slice(12);
  const changes = [
    { name: "a flush with setValue", change: { kind: "flush", text: NEW_TEXT }, after: NEW_TEXT },
    { name: "a language change", change: { kind: "language", language: "plaintext" }, after: AFTER_X },
  ] as const;

  for (const { name, change, after } of changes) {
    test(`${name}, in Normal: u brings nothing back, the mark is gone, and Vim keeps working`, async ({
      page,
      context,
    }) => {
      await activate(page, context, 9);
      // A change to undo, and a mark on the "(" after it, which every text here has at offset 11 or 12.
      await page.keyboard.type("xlma0");
      expect(await monacoText(page)).toBe(AFTER_X);
      await changeFromOutside(page, change);
      await page.keyboard.type("u");
      expect(await monacoText(page)).toBe(after);
      const [before] = await monacoSelections(page);
      await page.keyboard.type("`a");
      expect(await monacoSelections(page)).toEqual([before]);
      // Vim keeps working, on the text as it is now, with a history that starts here.
      await page.keyboard.type("ggdd");
      expect(await monacoText(page)).toBe(after.slice(after.indexOf("\n") + 1));
      await page.keyboard.type("u");
      expect(await monacoText(page)).toBe(after);
      await page.keyboard.type("u");
      expect(await monacoText(page)).toBe(after);
      await expect.poll(() => statusText(page)).toContain("NORMAL");
    });
  }

  test("a flush with setValue, in Insert: after Esc, u brings nothing back", async ({ page, context }) => {
    await activate(page, context);
    await page.keyboard.type("x");
    await page.keyboard.type("iab");
    expect(await monacoText(page)).toBe("ab" + MONACO_TEXT.slice(1));
    await changeFromOutside(page, { kind: "flush", text: NEW_TEXT });
    await page.keyboard.press("Escape");
    await expect.poll(() => statusText(page)).toContain("NORMAL");
    await page.keyboard.type("uu");
    expect(await monacoText(page)).toBe(NEW_TEXT);
    await page.keyboard.type("ggdd");
    expect(await monacoText(page)).toBe(NEW_TEXT.slice(NEW_TEXT.indexOf("\n") + 1));
  });
});

test.describe("the page swaps the editor's model", () => {
  // Monaco makes the editor's elements anew on a swap (docs/engine-seams.md, "Monaco: changes
  // from outside"), so the Session on the old input ends and, outside Insert and Replace, one
  // on the new input takes the keys in Normal.
  test("in Normal: Normal on the new model, u brings nothing back, the mark is gone, and Vim keeps working", async ({
    page,
    context,
  }) => {
    await activate(page, context, 9);
    await page.keyboard.type("xlma0");
    await changeFromOutside(page, { kind: "model", text: NEW_TEXT });
    await expect.poll(() => shownStatusText(page)).toContain("NORMAL");
    expect(await hostCount(page)).toBe(1);
    expect(await monacoCursorStyle(page)).toBe("Block");
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(NEW_TEXT);
    const [before] = await monacoSelections(page);
    await page.keyboard.type("`a");
    expect(await monacoSelections(page)).toEqual([before]);
    await page.keyboard.type("ggdd");
    expect(await monacoText(page)).toBe(NEW_TEXT.slice(NEW_TEXT.indexOf("\n") + 1));
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(NEW_TEXT);
  });

  test("in Visual: Normal on the new model, and the next key is Vim's", async ({ page, context }) => {
    await activate(page, context);
    await page.keyboard.type("ve");
    await expect.poll(() => statusText(page)).toContain("VISUAL");
    await changeFromOutside(page, { kind: "model", text: NEW_TEXT });
    await expect.poll(() => shownStatusText(page)).toContain("NORMAL");
    expect(await hostCount(page)).toBe(1);
    await page.keyboard.type("dd");
    expect(await monacoText(page)).toBe(NEW_TEXT.slice(NEW_TEXT.indexOf("\n") + 1));
  });

  for (const [mode, key] of [
    ["Insert", "i"],
    ["Replace", "R"],
  ] as const) {
    test(`in ${mode}: the Session ends, typing stays Monaco's with the page's cursor style, and Esc Activates on the new model`, async ({
      page,
      context,
    }) => {
      await activate(page, context);
      await page.keyboard.type(key);
      await expect.poll(() => statusText(page)).toContain(mode.toUpperCase());
      await changeFromOutside(page, { kind: "model", text: NEW_TEXT });
      await expect.poll(() => hostCount(page)).toBe(0);
      expect(await monacoCursorStyle(page)).toBe("Line");
      await page.keyboard.type("z");
      expect(await monacoText(page)).toBe("z" + NEW_TEXT);
      await page.keyboard.press("Escape");
      await expect.poll(() => shownStatusText(page)).toContain("NORMAL");
      await page.keyboard.type("u");
      expect(await monacoText(page)).toBe("z" + NEW_TEXT);
      await page.keyboard.type("0x");
      expect(await monacoText(page)).toBe(NEW_TEXT);
    });
  }

  test("in Insert on a Site with a Normal Start Mode: typing stays Monaco's on the new model", async ({
    page,
    context,
  }) => {
    await setMonacoSetting(context, true, { sites: { [fixtureOrigin]: "normal" } });
    await openMonaco(page);
    await focusMonaco(page);
    await expect.poll(() => statusText(page)).toContain("NORMAL");
    await page.keyboard.type("i");
    await expect.poll(() => statusText(page)).toContain("INSERT");
    await changeFromOutside(page, { kind: "model", text: NEW_TEXT });
    await expect.poll(() => hostCount(page)).toBe(0);
    await page.keyboard.type("x");
    expect(await monacoText(page)).toBe("x" + NEW_TEXT);
  });
});

test.describe("several editors on one page are separate Fields", () => {
  test("two code editors: each has its own Session, undo history and marks", async ({ page, context }) => {
    await activate(page, context, 0, { second: true });
    // The first editor: a change, and mark a on its second character.
    await page.keyboard.type("xlma0");
    expect(await monacoText(page)).toBe(MONACO_TEXT.slice(1));

    await focusMonaco(page, 0, 1);
    await page.keyboard.press("Escape");
    await expect.poll(() => shownStatusText(page)).toContain("NORMAL");
    expect(await hostCount(page)).toBe(2);
    // Mark a is the first editor's: here it is not set, and the Cursor stays.
    await page.keyboard.type("`a");
    expect(await monacoSelections(page, 1)).toEqual([{ anchor: 0, head: 0 }]);
    await page.keyboard.type("dd");
    expect(await monacoText(page, 1)).toBe(SECOND_TEXT.slice(SECOND_TEXT.indexOf("\n") + 1));
    // Its history holds its own change and nothing of the first editor's.
    await page.keyboard.type("uu");
    expect(await monacoText(page, 1)).toBe(SECOND_TEXT);
    expect(await monacoText(page)).toBe(MONACO_TEXT.slice(1));
    await page.keyboard.type("x");
    expect(await monacoText(page, 1)).toBe(SECOND_TEXT.slice(1));

    // Back in the first: its Mode, its mark and its history are as it left them.
    await focusMonaco(page, 0);
    await expect.poll(() => shownStatusText(page)).toContain("NORMAL");
    await page.keyboard.type("`a");
    expect(await monacoSelections(page)).toEqual([{ anchor: 1, head: 1 }]);
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
    expect(await monacoText(page, 1)).toBe(SECOND_TEXT.slice(1));
  });

  test("a one-line editor beside the code editor is its own Field", async ({ page, context }) => {
    await activate(page, context, 0, { oneLine: true });
    await page.keyboard.type("x");
    await focusMonaco(page, 0, 1);
    await page.keyboard.press("Escape");
    await expect.poll(() => shownStatusText(page)).toContain("NORMAL");
    expect(await hostCount(page)).toBe(2);
    expect(await monacoCursorStyle(page, 1)).toBe("Block");
    await page.keyboard.type("wx");
    expect(await monacoText(page, 1)).toBe("one ine of text");
    await page.keyboard.type("u");
    expect(await monacoText(page, 1)).toBe(ONE_LINE_TEXT);
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(MONACO_TEXT.slice(1));
  });
});

test.describe("Monaco's find and rename inputs remain Fields of their own text", () => {
  test("the find input: Esc Activates it as a textarea Field, and x edits the search text, not the code", async ({
    page,
    context,
  }) => {
    await setMonacoSetting(context, true);
    await openMonaco(page);
    await focusMonaco(page);
    await withEditor(page, (ed) => ed.trigger("test", "actions.find", null), null);
    const find = page.locator("#editor .find-widget .find-part textarea");
    await expect(find).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("twice");
    await expect(find).toHaveValue("twice");
    await page.keyboard.press("Escape");
    await expect.poll(() => shownStatusText(page)).toContain("NORMAL");
    await page.keyboard.type("0x");
    await expect(find).toHaveValue("wice");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
  });

  test("the rename input: Esc Activates it as a Single-line Field, and x edits the new name, not the code", async ({
    page,
    context,
  }) => {
    await setMonacoSetting(context, true);
    await openMonaco(page);
    // A rename provider, which the fixture's language has none of: it offers the word at the caret.
    await page.evaluate(() => {
      const m = (window as unknown as { fixtureMonaco: typeof import("monaco-editor") }).fixtureMonaco;
      m.languages.registerRenameProvider("javascript", {
        provideRenameEdits: () => ({ edits: [] }),
        resolveRenameLocation: (model, position) => {
          const word = model.getWordAtPosition(position)!;
          return {
            text: word.word,
            range: new m.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          };
        },
      });
    });
    await focusMonaco(page, 9);
    await withEditor(page, (ed) => ed.trigger("test", "editor.action.rename", null), null);
    const rename = page.locator("#editor input.rename-input");
    await expect(rename).toBeFocused();
    await expect(rename).toHaveValue("add");
    await page.keyboard.press("Escape");
    await expect.poll(() => shownStatusText(page)).toContain("NORMAL");
    await page.keyboard.type("0x");
    await expect(rename).toHaveValue("dd");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
  });
});

// The lifecycle of a Session on a Monaco Field in each Mode (CODING_STANDARDS rule 5; #118's
// cases were from Normal). The page set an underline cursor, so that "the page's style" is told
// from Monaco's default.
test.describe("the Session's lifecycle on a Monaco Field, in each Mode", () => {
  const PAGE_STYLE = "Underline";
  interface ModeRow {
    mode: "Normal" | "Visual" | "Insert" | "Replace";
    /** The keys from Normal that enter the Mode. */
    enter: string;
    /** The cursor style while the Session shows the Mode. */
    style: string;
    /** A key that tells the Mode, and the text it leaves of the fixture's. */
    key: string;
    held: string;
    /** The text after `q` typed with no Session: Monaco types it, over the selection where there is one. */
    typed: string;
  }
  const rows: ModeRow[] = [
    {
      mode: "Normal",
      enter: "",
      style: "Block",
      key: "x",
      held: MONACO_TEXT.slice(1),
      typed: "q" + MONACO_TEXT,
    },
    {
      mode: "Visual",
      enter: "ve",
      style: PAGE_STYLE,
      key: "d",
      held: MONACO_TEXT.slice(8),
      typed: "q" + MONACO_TEXT.slice(8),
    },
    {
      mode: "Insert",
      enter: "i",
      style: PAGE_STYLE,
      key: "z",
      held: "z" + MONACO_TEXT,
      typed: "q" + MONACO_TEXT,
    },
    {
      mode: "Replace",
      enter: "R",
      style: PAGE_STYLE,
      key: "z",
      held: "z" + MONACO_TEXT.slice(1),
      typed: "q" + MONACO_TEXT,
    },
  ];

  /** Activates the editor of a page that set the underline cursor style, and enters the row's Mode. */
  async function enter(page: Page, context: BrowserContext, row: ModeRow): Promise<void> {
    await setMonacoSetting(context, true);
    await openMonaco(page);
    await withEditor(page, (ed) => ed.updateOptions({ cursorStyle: "underline" }), null);
    await focusMonaco(page);
    await page.keyboard.press("Escape");
    await expect.poll(() => statusText(page)).toContain("NORMAL");
    if (row.enter) await page.keyboard.type(row.enter);
    await expect.poll(() => statusText(page)).toContain(row.mode.toUpperCase());
    expect(await monacoCursorStyle(page)).toBe(row.style);
  }

  const endings: [string, (context: BrowserContext) => Promise<void>][] = [
    ["the setting switched off", (context) => setMonacoSetting(context, false)],
    [
      "Site Policy set to off",
      (context) => setMonacoSetting(context, true, { sites: { [fixtureOrigin]: "off" } }),
    ],
    [
      "the global switch off",
      (context) => setSettings(context, { enabled: false, sites: {}, vimrc: "", plugins: {}, monaco: true }),
    ],
  ];

  for (const row of rows) {
    test(`${row.mode}: blur hides the Status Line and gives the page's cursor style back, and refocus resumes ${row.mode}`, async ({
      page,
      context,
    }) => {
      await enter(page, context, row);
      await page.locator("#plain").focus();
      await expect.poll(() => shownStatusText(page)).toBe("");
      expect(await monacoCursorStyle(page)).toBe(PAGE_STYLE);
      await withEditor(page, (ed) => ed.focus(), null);
      await expect.poll(() => shownStatusText(page)).toContain(row.mode.toUpperCase());
      expect(await monacoCursorStyle(page)).toBe(row.style);
      await page.keyboard.type(row.key);
      expect(await monacoText(page)).toBe(row.held);
    });

    for (const [name, end] of endings) {
      test(`${row.mode}: ${name} ends the Session at once: no Status Line, the page's cursor style, and keys are Monaco's`, async ({
        page,
        context,
      }) => {
        await enter(page, context, row);
        await end(context);
        await page.bringToFront();
        await expect.poll(() => hostCount(page)).toBe(0);
        expect(await monacoCursorStyle(page)).toBe(PAGE_STYLE);
        await page.keyboard.type("q");
        expect(await monacoText(page)).toBe(row.typed);
        // Esc is the page's again too: nothing Activates.
        await page.keyboard.press("Escape");
        expect(await hostCount(page)).toBe(0);
      });
    }

    test(`${row.mode}: the editor removed from the page disposes the Session`, async ({ page, context }) => {
      await enter(page, context, row);
      expect(await hostCount(page)).toBe(1);
      await page.evaluate(() => document.getElementById("editor")!.remove());
      await expect.poll(() => hostCount(page)).toBe(0);
    });
  }
});

test.describe("Site Policy and the popup on a Monaco Field", () => {
  test("a Site with a Normal Start Mode starts a Monaco Field in Normal, on focus alone", async ({
    page,
    context,
  }) => {
    await setMonacoSetting(context, true, { sites: { [fixtureOrigin]: "normal" } });
    await openMonaco(page);
    await focusMonaco(page);
    await expect.poll(() => statusText(page)).toContain("NORMAL");
    expect(await monacoCursorStyle(page)).toBe("Block");
    await page.keyboard.type("x");
    expect(await monacoText(page)).toBe(MONACO_TEXT.slice(1));
  });

  for (const [mode, keys] of [
    ["NORMAL", ""],
    ["VISUAL", "v"],
    ["INSERT", "i"],
  ] as const) {
    test(`the popup shows ${mode} for a focused Monaco Field in that Mode`, async ({ page, context }) => {
      await activate(page, context);
      if (keys) await page.keyboard.type(keys);
      await expect.poll(() => statusText(page)).toContain(mode);
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
      // The popup queries the active tab; make the fixture page the active one.
      await page.bringToFront();
      await popup.reload();
      await expect(popup.locator("#origin")).toHaveText(fixtureOrigin);
      await expect(popup.locator("#mode")).toHaveText(mode);
    });
  }
});
