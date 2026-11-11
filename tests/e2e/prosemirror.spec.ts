import { test, expect, ready, activateAtStart, selectedText } from "./extension";
import type { Page } from "@playwright/test";

/**
 * VimText on the pinned ProseMirror build (#46, ADR 0007) through the built
 * extension: real keys, ProseMirror's own document read back from the editor
 * (`pmDoc`, see tests/fixtures/prosemirror.ts), not the DOM. Marks print as
 * `<b>`, `<i>`, `<a>`; a list as `ul[li[…],…]`.
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
  expect(await pmDoc(page)).toEqual(ORIGINAL);
  await page.keyboard.type("wx");
  expect((await pmDoc(page))[0]).toBe("the <b>uick brown</b> fox");
  expect(await selectedText(page)).toBe("u");
  await page.keyboard.type("wcw");
  await page.keyboard.type("lazy");
  await page.keyboard.press("Escape");
  // The plain space after the bold run stays plain.
  expect((await pmDoc(page))[0]).toBe("the <b>uick lazy</b> fox");
  await page.keyboard.type("0dw");
  expect((await pmDoc(page))[0]).toBe("<b>uick lazy</b> fox");
  await page.keyboard.type("j0wdw");
  expect((await pmDoc(page))[1]).toBe("jumps the <a>lazy dog</a>");
  await page.keyboard.type("wx");
  expect((await pmDoc(page))[1]).toBe("jumps the <a>azy dog</a>");
});

test("o, dd, linewise p and J split and merge paragraphs and list items in ProseMirror's document", async ({
  page,
}) => {
  await page.keyboard.type("o");
  await page.keyboard.type("new para");
  await page.keyboard.press("Escape");
  expect(await pmDoc(page)).toEqual([ORIGINAL[0], "new para", ...ORIGINAL.slice(1)]);
  await page.keyboard.type("jjo");
  await page.keyboard.type("new item");
  await page.keyboard.press("Escape");
  expect((await pmDoc(page))[3]).toBe("ul[li[first item],li[new item],li[second <b>item</b>]]");
  await page.keyboard.type("dd");
  expect((await pmDoc(page))[3]).toBe(ORIGINAL[2]);
  // Registers hold plain text: the pasted line is a list item without the bold.
  await page.keyboard.type("ggyyjjjp");
  expect((await pmDoc(page))[3]).toBe("ul[li[first item],li[the quick brown fox],li[second <b>item</b>]]");
  await page.keyboard.type("J");
  expect((await pmDoc(page))[3]).toBe("ul[li[first item],li[the quick brown fox second <b>item</b>]]");
  await page.keyboard.type("jdd");
  expect(await pmDoc(page)).toEqual([
    ORIGINAL[0],
    "new para",
    ORIGINAL[1],
    "ul[li[first item],li[the quick brown fox second <b>item</b>]]",
  ]);
});

/** ProseMirror's document without its marks: `u` restores the text, and a re-inserted character takes the marks of where it is typed (docs/engine-seams.md, "Block merges and splits"). */
async function pmText(page: Page): Promise<string[]> {
  return (await pmDoc(page)).map((block) => block.replace(/<\/?[a-z]+>/g, ""));
}

test("u restores the text and ProseMirror accepts it; Cmd+Z and Ctrl+Z in Normal are swallowed", async ({
  page,
}) => {
  const original = await pmText(page);
  await page.keyboard.type("wx");
  await page.keyboard.type("jdd");
  const edited = await pmDoc(page);
  await page.keyboard.press("Meta+z");
  await page.keyboard.press("Control+z");
  expect(await pmDoc(page)).toEqual(edited);
  await page.keyboard.type("uu");
  expect(await pmText(page)).toEqual(original);
  // ProseMirror took the restored text into its model: a further edit applies to it.
  await page.keyboard.type("x");
  expect((await pmText(page))[0]).toBe("the uick brown fox");
});

test("an input rule's rewrite syncs into the mirror and undoes with the change that provoked it", async ({
  page,
}) => {
  await page.keyboard.type("Gfx");
  await page.keyboard.type("r-");
  expect((await pmDoc(page))[3]).toBe("wait— here");
  await page.keyboard.type("$x");
  expect((await pmDoc(page))[3]).toBe("wait— her");
  await page.keyboard.type("u");
  expect((await pmDoc(page))[3]).toBe("wait— here");
  await page.keyboard.type("u");
  expect((await pmDoc(page))[3]).toBe("wait-x here");
});
