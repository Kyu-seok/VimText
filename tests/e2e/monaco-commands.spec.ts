import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, setSettings, statusText } from "./extension";
import { fixtureOrigin } from "./fixture-port";
import {
  MONACO_TEXT,
  focusMonaco,
  monacoSelections,
  monacoText,
  openMonaco,
  setMonacoSetting,
  withEditor,
} from "./monaco";

// The rest of Vim on a Monaco Field (#119; the command list is #113's Q17):
// what works on a textarea Field works here, because the engine is the same
// and only the Field differs. Read through the editor, as the other Monaco
// specs do; in both projects, so on both input kinds.
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

/** The fixture's text with its first line replaced by `lines`. */
function withFirstLine(...lines: string[]): string {
  return [...lines, ...LINES.slice(1)].join("\n");
}

interface Opening {
  offset?: number;
  vimrc?: string;
  plugins?: { surround?: boolean; targets?: boolean };
}

/** Opens the fixture with the setting on and Activates the editor with Esc, the caret at `offset`. */
async function activate(
  page: Page,
  context: BrowserContext,
  { offset = 0, vimrc = "", plugins = {} }: Opening = {},
): Promise<void> {
  await setSettings(context, { enabled: true, sites: {}, vimrc, plugins, monaco: true });
  await openMonaco(page);
  await focusMonaco(page, offset);
  await page.keyboard.press("Escape");
  await expect.poll(() => statusText(page)).toContain("NORMAL");
}

/**
 * The text of the Status Line that shows. The page has one per Activated Field,
 * the blurred Field's hidden, so `statusText`, which reads the first, is not enough here.
 */
function shownStatusText(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("vimtext-status")]
      .filter((host) => !host.hidden)
      .map((host) => host.shadowRoot?.querySelector(".bar")?.textContent ?? "")
      .join("|"),
  );
}

/** Whether the editor has text focus, as Monaco itself tells it. */
function editorHasFocus(page: Page): Promise<boolean> {
  return withEditor(page, (ed) => ed.hasTextFocus(), null);
}

/** Whether focus is in VimText's Status Line, where the command line's input is. */
function commandLineHasFocus(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement?.localName === "vimtext-status");
}

/**
 * Each change, typed from Normal with the Cursor at `offset`, and the text it
 * leaves. Every one is then undone by one `u`: the fixture's text back means
 * the change was one undo step, since a change of two steps would leave the
 * state between them.
 */
const changes: { name: string; offset?: number; keys: string; esc?: boolean; text: string }[] = [
  { name: "yyp puts the yanked line below", keys: "yyp", text: withFirstLine(LINES[0]!, LINES[0]!) },
  { name: "cw changes the word", keys: "cwfn", esc: true, text: withFirstLine("fn add(a, b) {") },
  { name: "r replaces the character", keys: "rF", text: withFirstLine("Function add(a, b) {") },
  {
    name: "J joins the next line",
    keys: "J",
    text: ["function add(a, b) { return a + b;", ...LINES.slice(2)].join("\n"),
  },
  { name: "o opens a line below", keys: "ohi", esc: true, text: withFirstLine(LINES[0]!, "hi") },
  { name: "O opens a line above", keys: "Ohi", esc: true, text: withFirstLine("hi", LINES[0]!) },
  { name: "o then Esc leaves an empty line", keys: "o", esc: true, text: withFirstLine(LINES[0]!, "") },
  { name: "3x deletes three characters", keys: "3x", text: withFirstLine("ction add(a, b) {") },
  { name: "2dd deletes two lines", keys: "2dd", text: LINES.slice(2).join("\n") },
  { name: "a Visual delete (vex)", keys: "vex", text: withFirstLine(" add(a, b) {") },
  { name: "a Visual Line delete (Vjd)", keys: "Vjd", text: LINES.slice(2).join("\n") },
];

test.describe("Vim's changes edit the code, each one undo step for u", () => {
  for (const change of changes) {
    test(change.name, async ({ page, context }) => {
      await activate(page, context, { offset: change.offset });
      await page.keyboard.type(change.keys);
      if (change.esc) await page.keyboard.press("Escape");
      await expect.poll(() => statusText(page)).toContain("NORMAL");
      expect(await monacoText(page)).toBe(change.text);
      await page.keyboard.type("u");
      expect(await monacoText(page)).toBe(MONACO_TEXT);
    });
  }

  test(". repeats the change, and u undoes the repeat alone", async ({ page, context }) => {
    await activate(page, context);
    await page.keyboard.type("dw");
    expect(await monacoText(page)).toBe(withFirstLine("add(a, b) {"));
    await page.keyboard.type(".");
    expect(await monacoText(page)).toBe(withFirstLine("(a, b) {"));
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(withFirstLine("add(a, b) {"));
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
  });
});

test.describe("the command line on a Monaco Field", () => {
  test(":s/a/b/ substitutes on the Cursor's line, one undo step, and the next key is Vim's", async ({
    page,
    context,
  }) => {
    await activate(page, context);
    await page.keyboard.press(":");
    await expect.poll(() => commandLineHasFocus(page)).toBe(true);
    await page.keyboard.type("s/a/b/");
    // The command line took the keys: none reached the code.
    expect(await monacoText(page)).toBe(MONACO_TEXT);
    await page.keyboard.press("Enter");
    await expect.poll(() => editorHasFocus(page)).toBe(true);
    expect(await monacoText(page)).toBe(withFirstLine("function bdd(a, b) {"));
    // The next key is Vim's: `u` takes the substitution back whole.
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
  });

  test("/ search moves the Cursor to the match and n to the next; the next key is Vim's", async ({
    page,
    context,
  }) => {
    await activate(page, context);
    await page.keyboard.press("/");
    await expect.poll(() => commandLineHasFocus(page)).toBe(true);
    await page.keyboard.type("add");
    await page.keyboard.press("Enter");
    await expect.poll(() => editorHasFocus(page)).toBe(true);
    expect(await monacoText(page)).toBe(MONACO_TEXT);
    // "add" in "function add(a, b) {".
    expect(await monacoSelections(page)).toEqual([{ anchor: 9, head: 9 }]);
    await page.keyboard.type("n");
    // "add" in "  return add(n, n);".
    expect(await monacoSelections(page)).toEqual([{ anchor: 69, head: 69 }]);
    await page.keyboard.type("x");
    expect(await monacoText(page)).toBe(MONACO_TEXT.slice(0, 69) + MONACO_TEXT.slice(70));
  });

  for (const prompt of [":", "/"]) {
    test(`Esc in the ${prompt} command line gives focus back to the editor, and the next key is Vim's`, async ({
      page,
      context,
    }) => {
      await activate(page, context);
      await page.keyboard.type("w");
      await page.keyboard.press(prompt);
      await expect.poll(() => commandLineHasFocus(page)).toBe(true);
      await page.keyboard.type("dd");
      await page.keyboard.press("Escape");
      await expect.poll(() => editorHasFocus(page)).toBe(true);
      await expect.poll(() => statusText(page)).toContain("NORMAL");
      expect(await monacoText(page)).toBe(MONACO_TEXT);
      // `x` deletes the character `w` moved to: the Cursor stayed.
      await page.keyboard.type("x");
      expect(await monacoText(page)).toBe(withFirstLine("function dd(a, b) {"));
    });
  }
});

test.describe("registers are shared with the page's other Fields", () => {
  /** Focuses the plain textarea beside the editor and Activates it, the Cursor at its start. */
  async function activatePlain(page: Page): Promise<void> {
    const plain = page.locator("#plain");
    await plain.focus();
    await plain.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
    await page.keyboard.press("Escape");
    await expect.poll(() => shownStatusText(page)).toContain("NORMAL");
  }

  test("a yank in the Monaco Field puts in a textarea Field", async ({ page, context }) => {
    await activate(page, context);
    await page.keyboard.type("yiw");
    await activatePlain(page);
    await page.keyboard.type("P");
    await expect(page.locator("#plain")).toHaveValue("functiona plain textarea");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
  });

  test("a yank in a textarea Field puts in the Monaco Field", async ({ page, context }) => {
    await setMonacoSetting(context, true);
    await openMonaco(page);
    await activatePlain(page);
    await page.keyboard.type("wyiw");
    await focusMonaco(page);
    await page.keyboard.press("Escape");
    await expect.poll(() => editorHasFocus(page)).toBe(true);
    await expect.poll(() => shownStatusText(page)).toContain("NORMAL");
    await page.keyboard.type("P");
    expect(await monacoText(page)).toBe("plain" + MONACO_TEXT);
    await expect(page.locator("#plain")).toHaveValue("a plain textarea");
  });

  test('"+y writes the system clipboard and "+P reads it', async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: fixtureOrigin });
    await activate(page, context);
    await page.keyboard.type('"+yiw');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("function");
    await page.evaluate(() => navigator.clipboard.writeText("CLIP"));
    await page.keyboard.type('"+P');
    await expect.poll(() => monacoText(page)).toBe("CLIP" + MONACO_TEXT);
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
  });
});

test.describe("the vimrc and the Plugins apply in a Monaco Field", () => {
  test("a vimrc mapping: nnoremap Q dd", async ({ page, context }) => {
    await activate(page, context, { vimrc: "nnoremap Q dd" });
    await page.keyboard.type("Q");
    expect(await monacoText(page)).toBe(LINES.slice(1).join("\n"));
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
  });

  test("surround: cs)] changes the parentheses around the Cursor to brackets", async ({ page, context }) => {
    // Offset 13: the `a` of "(a, b)".
    await activate(page, context, { offset: 13, plugins: { surround: true } });
    await page.keyboard.type("cs)]");
    expect(await monacoText(page)).toBe(withFirstLine("function add[a, b] {"));
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
  });

  test("targets: dia deletes the argument under the Cursor, and din( inside the next parentheses", async ({
    page,
    context,
  }) => {
    await activate(page, context, { offset: 13, plugins: { targets: true } });
    await page.keyboard.type("dia");
    expect(await monacoText(page)).toBe(withFirstLine("function add(, b) {"));
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
    await page.keyboard.type("0din(");
    expect(await monacoText(page)).toBe(withFirstLine("function add() {"));
    await page.keyboard.type("u");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
  });
});
