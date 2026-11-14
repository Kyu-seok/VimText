import { test, expect, ready, activateAtStart, modelText, selectedText, statusText } from "./extension";
import type { Page } from "@playwright/test";

/**
 * VimText on the pinned ProseMirror build (#46, ADR 0007) through the built
 * extension: real keys, ProseMirror's own document read back from the editor
 * (`pmDoc`, see tests/fixtures/prosemirror.ts), not the DOM. Marks print as
 * `<b>`, `<i>`, `<a>`; a list as `ul[li[…],…]`. Its plain text, one line per
 * textblock, is `modelText`, the read every rich-editor fixture shares.
 */

const HOST = "#editor .ProseMirror";

const ORIGINAL = [
  "the <b>quick brown</b> fox",
  "jumps <i>over</i> the <a>lazy dog</a>",
  "ul[li[first item],li[second <b>item</b>]]",
  "wait-x here",
];

function pmDoc(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { pmDoc(): string[] }).pmDoc());
}

test.beforeEach(async ({ page }) => {
  await page.goto("/prosemirror.html");
  await ready(page);
  await activateAtStart(page, HOST);
});

test("x dw cw inside a bold run keep it bold; across a mark boundary the rest keeps its marks", async ({
  page,
}) => {
  await expect.poll(() => pmDoc(page)).toEqual(ORIGINAL);
  await page.keyboard.type("wx");
  await expect.poll(async () => (await pmDoc(page))[0]).toBe("the <b>uick brown</b> fox");
  await expect.poll(() => selectedText(page)).toBe("u");
  await page.keyboard.type("wcw");
  await page.keyboard.type("lazy");
  await page.keyboard.press("Escape");
  // The plain space after the bold run stays plain.
  await expect.poll(async () => (await pmDoc(page))[0]).toBe("the <b>uick lazy</b> fox");
  await page.keyboard.type("0dw");
  await expect.poll(async () => (await pmDoc(page))[0]).toBe("<b>uick lazy</b> fox");
  await page.keyboard.type("j0wdw");
  await expect.poll(async () => (await pmDoc(page))[1]).toBe("jumps the <a>lazy dog</a>");
  await page.keyboard.type("wx");
  await expect.poll(async () => (await pmDoc(page))[1]).toBe("jumps the <a>azy dog</a>");
});

test("o, dd, linewise p and J split and merge paragraphs and list items in ProseMirror's document", async ({
  page,
}) => {
  await page.keyboard.type("o");
  await page.keyboard.type("new para");
  await page.keyboard.press("Escape");
  await expect.poll(() => pmDoc(page)).toEqual([ORIGINAL[0], "new para", ...ORIGINAL.slice(1)]);
  await page.keyboard.type("jjo");
  await page.keyboard.type("new item");
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await pmDoc(page))[3])
    .toBe("ul[li[first item],li[new item],li[second <b>item</b>]]");
  await page.keyboard.type("dd");
  await expect.poll(async () => (await pmDoc(page))[3]).toBe(ORIGINAL[2]);
  // Registers hold plain text: the pasted line is a list item without the bold.
  await page.keyboard.type("ggyyjjjp");
  await expect
    .poll(async () => (await pmDoc(page))[3])
    .toBe("ul[li[first item],li[the quick brown fox],li[second <b>item</b>]]");
  await page.keyboard.type("J");
  await expect
    .poll(async () => (await pmDoc(page))[3])
    .toBe("ul[li[first item],li[the quick brown fox second <b>item</b>]]");
  await page.keyboard.type("jdd");
  await expect
    .poll(() => pmDoc(page))
    .toEqual([
      ORIGINAL[0],
      "new para",
      ORIGINAL[1],
      "ul[li[first item],li[the quick brown fox second <b>item</b>]]",
    ]);
  await expect
    .poll(() => modelText(page))
    .toEqual([
      "the quick brown fox",
      "new para",
      "jumps over the lazy dog",
      "first item",
      "the quick brown fox second item",
    ]);
});

// `u` restores ProseMirror's text (`modelText`, its marks left out): a
// re-inserted character takes the marks of where it is typed
// (docs/engine-seams.md, "Block merges and splits").
test("u restores the text and ProseMirror accepts it; Cmd+Z and Ctrl+Z in Normal are swallowed", async ({
  page,
}) => {
  const original = await modelText(page);
  expect(original).toEqual([
    "the quick brown fox",
    "jumps over the lazy dog",
    "first item",
    "second item",
    "wait-x here",
  ]);
  await page.keyboard.type("wx");
  await page.keyboard.type("jdd");
  await expect.poll(async () => (await pmDoc(page)).length).toBe(ORIGINAL.length - 1);
  const edited = await pmDoc(page);
  await page.keyboard.press("Meta+z");
  await page.keyboard.press("Control+z");
  await expect.poll(() => pmDoc(page)).toEqual(edited);
  await page.keyboard.type("uu");
  await expect.poll(() => modelText(page)).toEqual(original);
  // ProseMirror took the restored text into its model: a further edit applies to it.
  await page.keyboard.type("x");
  await expect.poll(async () => (await modelText(page))[0]).toBe("the uick brown fox");
});

test("an input rule's rewrite syncs into the mirror and undoes with the change that provoked it", async ({
  page,
}) => {
  await page.keyboard.type("Gfx");
  await page.keyboard.type("r-");
  await expect.poll(async () => (await pmDoc(page))[3]).toBe("wait— here");
  // The Normal cursor shows once the write has settled and its rewrite has
  // been judged (ADR 0008); for a key pressed before that, the rewrite joins
  // that key's undo step instead of the change that provoked it.
  await expect.poll(() => selectedText(page)).not.toBe("");
  await page.keyboard.type("$x");
  await expect.poll(async () => (await pmDoc(page))[3]).toBe("wait— her");
  await page.keyboard.type("u");
  await expect.poll(async () => (await pmDoc(page))[3]).toBe("wait— here");
  await page.keyboard.type("u");
  await expect.poll(async () => (await pmDoc(page))[3]).toBe("wait-x here");
});

test(":q leaves ProseMirror with nothing highlighted and its document unchanged; refocus resumes on the same character (#65)", async ({
  page,
}) => {
  const host = page.locator(HOST);
  await page.keyboard.type("l");
  await expect.poll(() => selectedText(page)).toBe("h");
  await page.keyboard.type(":q");
  await page.keyboard.press("Enter");
  await expect(host).not.toBeFocused();
  // ProseMirror re-applies its own selection when the DOM's changes: it must
  // not put the one-character cursor back.
  await expect.poll(() => page.evaluate(() => document.getSelection()!.isCollapsed)).toBe(true);
  expect(await statusText(page)).toBe("");
  expect(await pmDoc(page)).toEqual(ORIGINAL);
  await host.focus();
  await expect.poll(() => statusText(page)).toContain("NORMAL");
  await page.keyboard.type("x");
  await expect.poll(async () => (await pmDoc(page))[0]).toBe("te <b>quick brown</b> fox");
});
