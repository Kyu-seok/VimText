import { test, expect, ready, activateAtStart, modelText, statusText } from "./extension";
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
  await expect.poll(() => modelText(page)).toEqual(ORIGINAL);
  await expect
    .poll(() => quillDoc(page))
    .toEqual([
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
  await expect.poll(async () => (await quillDoc(page))[0]).toBe("the <b>uick brown</b> fox");
  await page.keyboard.type("lrX");
  await expect.poll(async () => (await quillDoc(page))[0]).toBe("the <b>uXck brown</b> fox");
  await page.keyboard.type("wcw");
  await page.keyboard.type("lazy");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await quillDoc(page))[0]).toBe("the <b>uXck lazy</b> fox");
  await typeAfter(page, "!");
  await expect.poll(async () => (await modelText(page))[0]).toBe("the uXck laz!y fox");
  // dw from "the" removes the plain word and its space; the bold run keeps its marks.
  await page.keyboard.type("0dw");
  await expect.poll(async () => (await quillDoc(page))[0]).toBe("<b>uXck laz!y</b> fox");
  await typeAfter(page, "A");
  await expect.poll(async () => (await modelText(page))[0]).toBe("AuXck laz!y fox");
  await expect.poll(async () => (await modelText(page)).slice(1)).toEqual(ORIGINAL.slice(1));
});

test("dw on a whole bold word deletes it; the cursor stays where Vim puts it (#59)", async ({ page }) => {
  await page.keyboard.type("wdw");
  await expect.poll(async () => (await quillDoc(page))[0]).toBe("the <b>brown</b> fox");
  await page.keyboard.type("dw");
  await expect.poll(async () => (await quillDoc(page))[0]).toBe("the fox");
  await expect.poll(async () => (await modelText(page)).slice(1)).toEqual(ORIGINAL.slice(1));
  // #59: Quill merges `the ` and ` fox` into one text node a microtask after
  // the write, which collapses the native selection. The selection is set once
  // the write has settled (#52, ADR 0008), so the cursor stays on `f` and the
  // next `dw` deletes `fox`.
  await page.keyboard.type("dw");
  await expect.poll(async () => (await modelText(page))[0]).toBe("the ");
});

test("dd removes a block from Quill's model; a real keystroke after it lands at the cursor", async ({
  page,
}) => {
  await page.keyboard.type("dd");
  // The header's text moves into the first line's <p> and loses its format: the
  // same text, other markup (docs/engine-seams.md, "Block merges and splits").
  await expect
    .poll(() => quillDoc(page))
    .toEqual(["a heading", "bullet:first item", "bullet:second item", `a cat ${EMBED} here`, "last line"]);
  await typeAfter(page, "Z");
  await expect.poll(async () => (await modelText(page))[0]).toBe("Za heading");
  await page.keyboard.type("Gdd");
  await expect
    .poll(() => modelText(page))
    .toEqual(["Za heading", "first item", "second item", `a cat ${EMBED} here`]);
  await typeAfter(page, "Q");
  await expect.poll(async () => (await modelText(page))[3]).toBe(`Qa cat ${EMBED} here`);
});

test("J and a Visual delete across lines merge Quill's blocks; a real keystroke after each keeps them", async ({
  page,
}) => {
  // The heading's text joins the paragraph above it. `J` writes one
  // `insertText(' ')` over the line break, which Quill's Input module takes
  // from the synthetic `beforeinput` (ADR 0008) and applies as a Delta: the
  // first line's `\n` goes, so the joined line keeps the heading's line
  // format, as typing a space over a selection across the two lines does.
  // (Under `execCommand` alone it kept the paragraph's.)
  await page.keyboard.type("J");
  await expect
    .poll(() => quillDoc(page))
    .toEqual([
      "h1:the <b>quick brown</b> fox a heading",
      "bullet:first item",
      "bullet:second item",
      `a cat ${EMBED} here`,
      "last line",
    ]);
  await typeAfter(page, ",");
  await expect.poll(async () => (await modelText(page))[0]).toBe("the quick brown fox, a heading");
  // From `cat` on the embed's line to `t` and the space after it on the last line, inclusive.
  await page.keyboard.type("Gkwvjlld");
  await expect.poll(async () => (await modelText(page)).slice(3)).toEqual(["a line"]);
  await typeAfter(page, "Y");
  await expect
    .poll(() => modelText(page))
    .toEqual(["the quick brown fox, a heading", "first item", "second item", "a Yline"]);
});

test("o and linewise p open a new block below; r<CR> splits a line without losing text", async ({ page }) => {
  await page.keyboard.type("o");
  await page.keyboard.type("new para");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => quillDoc(page))
    .toEqual([
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
  await expect
    .poll(async () => (await quillDoc(page)).slice(6))
    .toEqual(["last line", "the quick brown fox"]);
  await typeAfter(page, ">");
  await expect.poll(async () => (await modelText(page))[7]).toBe(">the quick brown fox");
  // r<CR> on the `b` of the bold `brown`: both halves stay bold.
  await page.keyboard.type("ggwwr\n");
  await expect
    .poll(async () => (await quillDoc(page)).slice(0, 2))
    .toEqual(["the <b>quick </b>", "<b>rown</b> fox"]);
  await typeAfter(page, "B");
  await expect
    .poll(async () => (await modelText(page)).slice(0, 3))
    .toEqual(["the quick ", "Brown fox", "new para"]);
});

test("o on a list item opens a list item; o on a header opens a plain line, as Enter there does", async ({
  page,
}) => {
  await page.keyboard.type("jjo");
  await page.keyboard.type("new item");
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await quillDoc(page)).slice(2, 5))
    .toEqual(["bullet:first item", "bullet:new item", "bullet:second item"]);
  await page.keyboard.type("jo");
  await page.keyboard.type("last item");
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await quillDoc(page)).slice(4, 7))
    .toEqual(["bullet:second item", "bullet:last item", `a cat ${EMBED} here`]);
  await page.keyboard.type("ggjo");
  await page.keyboard.type("body");
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await quillDoc(page)).slice(1, 4))
    .toEqual(["h1:a heading", "body", "bullet:first item"]);
});

test("a linewise p below a header loses the pasted line (#61)", async ({ page }) => {
  await page.keyboard.type("yyjp");
  // Pins #61, not what Vim does: Chromium's insertParagraph at the end of an
  // <h1> makes a <div>, the insertText fills it, and Quill replaces the <div>
  // with an empty <p>. The new line should read `the quick brown fox`. Since
  // the write's steps are a task apart (#52, ADR 0008), whether Quill replaces
  // the <div> before or after the insertText lands depends on timing, so the
  // new line is either; every other line is as it should be.
  await expect.poll(async () => (await modelText(page)).length).toBe(ORIGINAL.length + 1);
  const lines = await modelText(page);
  expect(["", "the quick brown fox"]).toContain(lines[2]);
  expect(lines.filter((_, i) => i !== 2)).toEqual(ORIGINAL);
});

test("Quill's list marker counts as an Atom, so I and x on a list item go wrong (#60)", async ({ page }) => {
  // Pins #60, not what Vim does. Each list item starts with Quill's
  // <span class="ql-ui" contenteditable="false">, which the projection reads as
  // an Atom. `I` puts the caret before the span, and Quill moves the typed text
  // to the item's end: it should read `Zsecond item`.
  await page.keyboard.type("jjjI");
  await page.keyboard.type("Z");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await modelText(page))[3]).toBe("second itemZ");
  // `0x` on the span changes nothing (Quill keeps it): a Refused Edit. The
  // cursor stays on the span, its selection set once the write has settled
  // (#52, ADR 0008), so the next `x` is refused too: the line should read
  // `rst item`. (Before #52 the cursor slid onto `i`, and `x` deleted it.)
  await page.keyboard.type("k0x");
  // The refusal is judged once the write has settled; a key pressed before
  // then goes with the refused edit.
  await expect.poll(() => statusText(page)).toContain("refused");
  await page.keyboard.type("x");
  await expect.poll(() => statusText(page)).toContain("refused");
  await expect.poll(async () => (await modelText(page))[2]).toBe("first item");
});

test("x on the embed deletes it and u restores it; the next keystroke lands at the cursor", async ({
  page,
}) => {
  await page.keyboard.type("4jwwx");
  await expect.poll(async () => (await modelText(page))[4]).toBe("a cat  here");
  await page.keyboard.type("u");
  await expect.poll(() => modelText(page)).toEqual(ORIGINAL);
  await typeAfter(page, "big ");
  await expect.poll(async () => (await modelText(page))[4]).toBe(`a cat big ${EMBED} here`);
});

test("u and Ctrl-r restore Quill's text", async ({ page }) => {
  await page.keyboard.type("wx");
  await page.keyboard.type("jdd");
  await page.keyboard.type("Gdd");
  await expect
    .poll(() => modelText(page))
    .toEqual(["the uick brown fox", "first item", "second item", `a cat ${EMBED} here`]);
  const edited = await modelText(page);
  await page.keyboard.type("uuu");
  await expect.poll(() => modelText(page)).toEqual(ORIGINAL);
  await page.keyboard.press("Control+r");
  await page.keyboard.press("Control+r");
  await page.keyboard.press("Control+r");
  await expect.poll(() => modelText(page)).toEqual(edited);
  await page.keyboard.type("u");
  await expect.poll(() => modelText(page)).toEqual(["the uick brown fox", ...ORIGINAL.slice(2)]);
});
