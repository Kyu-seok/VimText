import { test, expect, ready, activateAtStart, modelText } from "./extension";
import type { Page } from "@playwright/test";

/**
 * VimText on the pinned Quill 2.0.3 build (#55, ADR 0008) through the built
 * extension: real keys, Quill's own model read back (`modelText`, and
 * `quillDoc` for its formats; see tests/fixtures/quill.ts), never the DOM.
 * Quill reads every write through its MutationObserver
 * (docs/research/editor-write-paths.md, "Quill"). After each write a real
 * keystroke in Insert shows the write survived in the model.
 */

const HOST = "#editor .ql-editor";
const EMBED = "￼";

const ORIGINAL = [
  "the quick brown fox",
  "a heading",
  "first item",
  "second item",
  `a cat ${EMBED} here`,
  "last line",
];

function quillDoc(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { quillDoc(): string[] }).quillDoc());
}

test.beforeEach(async ({ page }) => {
  await page.goto("/quill.html");
  await ready(page);
  await activateAtStart(page, HOST);
});

test("the fixture's model reads back one line per block", async ({ page }) => {
  expect(await modelText(page)).toEqual(ORIGINAL);
  expect(await quillDoc(page)).toEqual([
    "the <b>quick brown</b> fox",
    "h1:a heading",
    "bullet:first item",
    "bullet:second item",
    `a cat ${EMBED} here`,
    "last line",
  ]);
});

/** Insert `text` with real keys at the cursor and go back to Normal: Quill's own input after VimText's write. */
async function typeAfter(page: Page, text: string): Promise<void> {
  await page.keyboard.type("i");
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
}

test("x r cw inside the bold run keep it bold; dw across its edge trims both sides", async ({ page }) => {
  await page.keyboard.type("wx");
  expect((await quillDoc(page))[0]).toBe("the <b>uick brown</b> fox");
  await page.keyboard.type("lrX");
  expect((await quillDoc(page))[0]).toBe("the <b>uXck brown</b> fox");
  await page.keyboard.type("wcw");
  await page.keyboard.type("lazy");
  await page.keyboard.press("Escape");
  expect((await quillDoc(page))[0]).toBe("the <b>uXck lazy</b> fox");
  await typeAfter(page, "!");
  expect((await modelText(page))[0]).toBe("the uXck laz!y fox");
  // dw from "the" removes the plain word and its space; the bold run keeps its marks.
  await page.keyboard.type("0dw");
  expect((await quillDoc(page))[0]).toBe("<b>uXck laz!y</b> fox");
  await typeAfter(page, "A");
  expect((await modelText(page))[0]).toBe("AuXck laz!y fox");
  expect((await modelText(page)).slice(1)).toEqual(ORIGINAL.slice(1));
});

test("dw on a whole bold word deletes it; the cursor then jumps to the line's end (#59)", async ({
  page,
}) => {
  await page.keyboard.type("wdw");
  expect((await quillDoc(page))[0]).toBe("the <b>brown</b> fox");
  await page.keyboard.type("dw");
  expect((await quillDoc(page))[0]).toBe("the fox");
  expect((await modelText(page)).slice(1)).toEqual(ORIGINAL.slice(1));
  // Pins #59, not what Vim does: Quill merges `the ` and ` fox` into one text
  // node after the write, the native selection collapses after it, and VimText
  // takes that for a caret move. The cursor should stay on `f`, and the next
  // `dw` should leave `the `, not delete `x`.
  await page.keyboard.type("dw");
  expect((await modelText(page))[0]).toBe("the fo");
});

test("dd removes a block from Quill's model; a real keystroke after it lands at the cursor", async ({
  page,
}) => {
  await page.keyboard.type("dd");
  // The header's text moves into the first line's <p> and loses its format: the
  // same text, other markup (docs/engine-seams.md, "Block merges and splits").
  expect(await quillDoc(page)).toEqual([
    "a heading",
    "bullet:first item",
    "bullet:second item",
    `a cat ${EMBED} here`,
    "last line",
  ]);
  await typeAfter(page, "Z");
  expect((await modelText(page))[0]).toBe("Za heading");
  await page.keyboard.type("Gdd");
  expect(await modelText(page)).toEqual(["Za heading", "first item", "second item", `a cat ${EMBED} here`]);
  await typeAfter(page, "Q");
  expect((await modelText(page))[3]).toBe(`Qa cat ${EMBED} here`);
});

test("J and a Visual delete across lines merge Quill's blocks; a real keystroke after each keeps them", async ({
  page,
}) => {
  // The heading joins the paragraph above it, as Backspace at its start would.
  await page.keyboard.type("J");
  expect(await quillDoc(page)).toEqual([
    "the <b>quick brown</b> fox a heading",
    "bullet:first item",
    "bullet:second item",
    `a cat ${EMBED} here`,
    "last line",
  ]);
  await typeAfter(page, ",");
  expect((await modelText(page))[0]).toBe("the quick brown fox, a heading");
  // From `cat` on the embed's line to `t` and the space after it on the last line, inclusive.
  await page.keyboard.type("Gkwvjlld");
  expect((await modelText(page)).slice(3)).toEqual(["a line"]);
  await typeAfter(page, "Y");
  expect(await modelText(page)).toEqual([
    "the quick brown fox, a heading",
    "first item",
    "second item",
    "a Yline",
  ]);
});

test("o and linewise p open a new block below; r<CR> splits a line without losing text", async ({ page }) => {
  await page.keyboard.type("o");
  await page.keyboard.type("new para");
  await page.keyboard.press("Escape");
  expect(await quillDoc(page)).toEqual([
    "the <b>quick brown</b> fox",
    "new para",
    "h1:a heading",
    "bullet:first item",
    "bullet:second item",
    `a cat ${EMBED} here`,
    "last line",
  ]);
  // Registers hold plain text: the pasted line is not bold.
  await page.keyboard.type("ggyyGp");
  expect((await quillDoc(page)).slice(6)).toEqual(["last line", "the quick brown fox"]);
  await typeAfter(page, ">");
  expect((await modelText(page))[7]).toBe(">the quick brown fox");
  // r<CR> on the `b` of the bold `brown`: both halves stay bold.
  await page.keyboard.type("ggwwr\n");
  expect((await quillDoc(page)).slice(0, 2)).toEqual(["the <b>quick </b>", "<b>rown</b> fox"]);
  await typeAfter(page, "B");
  expect((await modelText(page)).slice(0, 3)).toEqual(["the quick ", "Brown fox", "new para"]);
});

test("o on a list item opens a list item; o on a header opens a plain line, as Enter there does", async ({
  page,
}) => {
  await page.keyboard.type("jjo");
  await page.keyboard.type("new item");
  await page.keyboard.press("Escape");
  expect((await quillDoc(page)).slice(2, 5)).toEqual([
    "bullet:first item",
    "bullet:new item",
    "bullet:second item",
  ]);
  await page.keyboard.type("jo");
  await page.keyboard.type("last item");
  await page.keyboard.press("Escape");
  expect((await quillDoc(page)).slice(4, 7)).toEqual([
    "bullet:second item",
    "bullet:last item",
    `a cat ${EMBED} here`,
  ]);
  await page.keyboard.type("ggjo");
  await page.keyboard.type("body");
  await page.keyboard.press("Escape");
  expect((await quillDoc(page)).slice(1, 4)).toEqual(["h1:a heading", "body", "bullet:first item"]);
});

test("a linewise p below a header loses the pasted line (#61)", async ({ page }) => {
  await page.keyboard.type("yyjp");
  // Pins #61, not what Vim does: Chromium's insertParagraph at the end of an
  // <h1> makes a <div>, the insertText fills it, and Quill replaces the <div>
  // with an empty <p>. The new line should read `the quick brown fox`.
  expect(await modelText(page)).toEqual([
    "the quick brown fox",
    "a heading",
    "",
    "first item",
    "second item",
    `a cat ${EMBED} here`,
    "last line",
  ]);
});

test("Quill's list marker counts as an Atom, so I and x on a list item go wrong (#60)", async ({ page }) => {
  // Pins #60, not what Vim does. Each list item starts with Quill's
  // <span class="ql-ui" contenteditable="false">, which the projection reads as
  // an Atom. `I` puts the caret before the span, and Quill moves the typed text
  // to the item's end: it should read `Zsecond item`.
  await page.keyboard.type("jjjI");
  await page.keyboard.type("Z");
  await page.keyboard.press("Escape");
  expect((await modelText(page))[3]).toBe("second itemZ");
  // `0x` on the span changes nothing (Quill keeps it), and the next `x`
  // deletes `i`, not `f`: the line should read `rst item`.
  await page.keyboard.type("k0xx");
  expect((await modelText(page))[2]).toBe("frst item");
});

test("x on the embed deletes it and u restores it; the next keystroke lands at the cursor", async ({
  page,
}) => {
  await page.keyboard.type("4jwwx");
  expect((await modelText(page))[4]).toBe("a cat  here");
  await page.keyboard.type("u");
  expect(await modelText(page)).toEqual(ORIGINAL);
  await typeAfter(page, "big ");
  expect((await modelText(page))[4]).toBe(`a cat big ${EMBED} here`);
});

test("u and Ctrl-r restore Quill's text", async ({ page }) => {
  await page.keyboard.type("wx");
  await page.keyboard.type("jdd");
  await page.keyboard.type("Gdd");
  const edited = await modelText(page);
  expect(edited).toEqual(["the uick brown fox", "first item", "second item", `a cat ${EMBED} here`]);
  await page.keyboard.type("uuu");
  expect(await modelText(page)).toEqual(ORIGINAL);
  await page.keyboard.press("Control+r");
  await page.keyboard.press("Control+r");
  await page.keyboard.press("Control+r");
  expect(await modelText(page)).toEqual(edited);
  await page.keyboard.type("u");
  expect(await modelText(page)).toEqual(["the uick brown fox", ...ORIGINAL.slice(2)]);
});
