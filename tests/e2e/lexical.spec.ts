import { test, expect, ready, activateAtStart, modelText, statusText } from "./extension";
import type { Page } from "@playwright/test";

/**
 * VimText on the pinned Lexical 0.53.0 build (#53, ADR 0008) through the built
 * extension: real keys, Lexical's own model read back (`modelText`, and
 * `lexicalDoc` for its formats; see tests/fixtures/lexical.ts), never the DOM.
 * Lexical takes its edits from `beforeinput` and reverts structural DOM
 * changes it did not make, so under `execCommand` alone `dd` was refused, a
 * Visual delete across lines left the lines unmerged, `o` put its text at the
 * start of the next line and `r<CR>` lost the text before the cursor
 * (docs/research/editor-write-paths.md, "Lexical"). Each write step now offers
 * the edit as a synthetic `beforeinput` from the content script's isolated
 * world, which Lexical takes over. After each write a real keystroke in
 * Insert shows the write survived in the model.
 */

const HOST = "#editor";
const ATOM = "￼";

const ORIGINAL = [
  "the quick brown fox",
  "a heading",
  "a quote",
  "first item",
  "second item",
  `a cat ${ATOM} here`,
  "last line",
];

function lexicalDoc(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { lexicalDoc(): string[] }).lexicalDoc());
}

test.beforeEach(async ({ page }) => {
  await page.goto("/lexical.html");
  await ready(page);
  await activateAtStart(page, HOST);
});

test("the fixture's model reads back one line per block", async ({ page }) => {
  await expect.poll(() => modelText(page)).toEqual(ORIGINAL);
  await expect
    .poll(() => lexicalDoc(page))
    .toEqual([
      "the <b>quick brown</b> fox",
      "h1:a heading",
      "quote:a quote",
      "bullet:first item",
      "bullet:second item",
      `a cat ${ATOM} here`,
      "last line",
    ]);
});

/** Insert `text` with real keys at the cursor and go back to Normal: Lexical's own input after VimText's write. */
async function typeAfter(page: Page, text: string): Promise<void> {
  await page.keyboard.type("i");
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
}

test("x r cw inside the bold run keep it bold; dw across its edge trims both sides", async ({ page }) => {
  await page.keyboard.type("wx");
  await expect.poll(async () => (await lexicalDoc(page))[0]).toBe("the <b>uick brown</b> fox");
  await page.keyboard.type("lrX");
  await expect.poll(async () => (await lexicalDoc(page))[0]).toBe("the <b>uXck brown</b> fox");
  await page.keyboard.type("wcw");
  await page.keyboard.type("lazy");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await lexicalDoc(page))[0]).toBe("the <b>uXck lazy</b> fox");
  await typeAfter(page, "!");
  await expect.poll(async () => (await modelText(page))[0]).toBe("the uXck laz!y fox");
  // dw from "the" removes the plain word and its space; the bold run keeps its marks.
  await page.keyboard.type("0dw");
  await expect.poll(async () => (await lexicalDoc(page))[0]).toBe("<b>uXck laz!y</b> fox");
  await typeAfter(page, "A");
  await expect.poll(async () => (await modelText(page))[0]).toBe("AuXck laz!y fox");
  await expect.poll(async () => (await modelText(page)).slice(1)).toEqual(ORIGINAL.slice(1));
});

test("r and cw across the bold run's edge replace text on both sides of it", async ({ page }) => {
  // `c2w` from the start: the plain word and the bold one after it.
  await page.keyboard.type("c2w");
  await page.keyboard.type("one");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await modelText(page))[0]).toBe("one brown fox");
  await typeAfter(page, "!");
  await expect.poll(async () => (await modelText(page))[0]).toBe("on!e brown fox");
  // `3rZ` on the `e`: `e`, the space and the bold `b`.
  await page.keyboard.type("l3rZ");
  await expect.poll(async () => (await modelText(page))[0]).toBe("on!ZZZrown fox");
  await typeAfter(page, "<");
  await expect.poll(async () => (await modelText(page))[0]).toBe("on!ZZ<Zrown fox");
  await expect.poll(async () => (await modelText(page)).slice(1)).toEqual(ORIGINAL.slice(1));
});

test("dw on a whole bold word deletes it (refused under execCommand alone)", async ({ page }) => {
  await page.keyboard.type("wdw");
  await expect.poll(async () => (await lexicalDoc(page))[0]).toBe("the <b>brown</b> fox");
  await page.keyboard.type("dw");
  await expect.poll(async () => (await lexicalDoc(page))[0]).toBe("the fox");
  await typeAfter(page, "big ");
  await expect.poll(async () => (await modelText(page))[0]).toBe("the big fox");
  await expect.poll(async () => (await modelText(page)).slice(1)).toEqual(ORIGINAL.slice(1));
});

test("dd removes a block from Lexical's model; a real keystroke after it lands at the cursor", async ({
  page,
}) => {
  await page.keyboard.type("dd");
  await expect
    .poll(() => modelText(page))
    .toEqual(["a heading", "a quote", "first item", "second item", `a cat ${ATOM} here`, "last line"]);
  await typeAfter(page, "Z");
  await expect.poll(async () => (await modelText(page))[0]).toBe("Za heading");
  await page.keyboard.type("Gdd");
  await expect
    .poll(() => modelText(page))
    .toEqual(["Za heading", "a quote", "first item", "second item", `a cat ${ATOM} here`]);
  await typeAfter(page, "Q");
  await expect.poll(async () => (await modelText(page))[4]).toBe(`Qa cat ${ATOM} here`);
});

test("J and a Visual delete across lines merge Lexical's blocks; a real keystroke after each keeps them", async ({
  page,
}) => {
  await page.keyboard.type("J");
  await expect
    .poll(() => modelText(page))
    .toEqual([
      "the quick brown fox a heading",
      "a quote",
      "first item",
      "second item",
      `a cat ${ATOM} here`,
      "last line",
    ]);
  await typeAfter(page, ",");
  await expect.poll(async () => (await modelText(page))[0]).toBe("the quick brown fox, a heading");
  // From `cat` on the decorator's line to `t` and the space after it on the last line, inclusive.
  await page.keyboard.type("Gkwvjlld");
  await expect.poll(async () => (await modelText(page)).slice(4)).toEqual(["a line"]);
  await typeAfter(page, "Y");
  await expect
    .poll(() => modelText(page))
    .toEqual(["the quick brown fox, a heading", "a quote", "first item", "second item", "a Yline"]);
});

test("o and linewise p open a new block below; r<CR> splits a line without losing text", async ({ page }) => {
  await page.keyboard.type("o");
  await page.keyboard.type("new para");
  await page.keyboard.press("Escape");
  await expect.poll(() => modelText(page)).toEqual(["the quick brown fox", "new para", ...ORIGINAL.slice(1)]);
  await page.keyboard.type("ggyyGp");
  await expect
    .poll(async () => (await modelText(page)).slice(7))
    .toEqual(["last line", "the quick brown fox"]);
  await typeAfter(page, ">");
  await expect.poll(async () => (await modelText(page))[8]).toBe(">the quick brown fox");
  // r<CR> on the `b` of `brown`: the text before it stays (under execCommand alone it was lost).
  await page.keyboard.type("ggwwr\n");
  await expect
    .poll(async () => (await modelText(page)).slice(0, 3))
    .toEqual(["the quick ", "rown fox", "new para"]);
  await typeAfter(page, "B");
  await expect
    .poll(async () => (await modelText(page)).slice(0, 3))
    .toEqual(["the quick ", "Brown fox", "new para"]);
});

test("x on the decorator deletes it; u restores the text around it, without the decorator (#62)", async ({
  page,
}) => {
  await page.keyboard.type("5jwwx");
  await expect.poll(async () => (await modelText(page))[5]).toBe("a cat  here");
  await typeAfter(page, "Z");
  await expect.poll(async () => (await modelText(page))[5]).toBe("a cat Z here");
  await page.keyboard.type("u");
  await expect.poll(async () => (await modelText(page))[5]).toBe("a cat  here");
  // The decorator's restore is offered as a `beforeinput` of `insertFromPaste`;
  // Lexical cancels it and does nothing, and a decorator cannot come back
  // through the DOM (`insertHTML` turned the line into `@cat`), so u restores
  // the text without it: DESIGN.md, "u restores text, not always marks or
  // markup". No Refused Edit: the Field's text stands.
  await page.keyboard.type("u");
  await expect(page.locator(`${HOST} .mention`)).toHaveCount(0);
  await expect.poll(() => modelText(page)).toEqual(ORIGINAL.map((l) => l.replace(ATOM, "")));
  expect(await statusText(page)).not.toContain("refused");
  // VimText follows the Field: a real keystroke and an x after it land on that text.
  await typeAfter(page, "Q");
  await page.keyboard.type("0x");
  await expect.poll(async () => (await modelText(page))[5]).toBe(" cat Q here");
});

test("u and Ctrl-r restore Lexical's text", async ({ page }) => {
  await page.keyboard.type("wx");
  await page.keyboard.type("jdd");
  await page.keyboard.type("Gdd");
  await expect
    .poll(() => modelText(page))
    .toEqual(["the uick brown fox", "a quote", "first item", "second item", `a cat ${ATOM} here`]);
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

/**
 * #66's sequence across a heading → quote boundary: `o` a line below the
 * heading, `J` it in, `u` (the line comes back as a heading: DESIGN.md, "u
 * restores text, not always marks or markup"), then `dd` on it. A linewise
 * deletion is written as `\nX` at the end of the line above
 * (docs/engine-seams.md, "Linewise writes"); written as `X\n` it would merge
 * the quote into the deleted line's heading.
 */
test("dd on a line above a quote leaves the quote's kind and text alone (#66)", async ({ page }) => {
  await page.keyboard.type("jo");
  await page.keyboard.type("new");
  await page.keyboard.press("Escape");
  await page.keyboard.type("kJ");
  await expect.poll(async () => (await modelText(page)).slice(1, 3)).toEqual(["a heading new", "a quote"]);
  await page.keyboard.type("u");
  await expect.poll(async () => (await modelText(page)).slice(1, 4)).toEqual(["a heading", "new", "a quote"]);
  await page.keyboard.type("gg2jdd");
  await expect
    .poll(() => lexicalDoc(page))
    .toEqual([
      "the <b>quick brown</b> fox",
      "h1:a heading",
      "quote:a quote",
      "bullet:first item",
      "bullet:second item",
      `a cat ${ATOM} here`,
      "last line",
    ]);
  await typeAfter(page, "Z");
  await expect.poll(async () => (await lexicalDoc(page))[2]).toBe("quote:Za quote");
});

/**
 * Why a write's deletion is offered as `deleteContentBackward` (ADR 0008):
 * Lexical cancels a synthetic `deleteContent` over a range and does nothing,
 * so offered that, a delete would be dropped (docs/engine-seams.md,
 * "deleteContent is dropped"). A bare-page probe on the fixture, no VimText
 * key involved.
 */
test("Lexical cancels a synthetic deleteContent and does nothing; deleteContentBackward deletes", async ({
  page,
}) => {
  const offer = (inputType: string) =>
    page.evaluate(async (type) => {
      const host = document.getElementById("editor")!;
      // `last line`, Lexical's text node inside its <span data-lexical-text>.
      const text = host.querySelector("p:last-child [data-lexical-text]")!.firstChild!;
      document.getSelection()!.setBaseAndExtent(text, 0, text, 5);
      document.dispatchEvent(new Event("selectionchange"));
      const range = new StaticRange({
        startContainer: text,
        startOffset: 0,
        endContainer: text,
        endOffset: 5,
      });
      const event = new InputEvent("beforeinput", {
        inputType: type,
        bubbles: true,
        cancelable: true,
        composed: true,
        targetRanges: [range],
      });
      host.dispatchEvent(event);
      await new Promise((r) => setTimeout(r, 50));
      return event.defaultPrevented;
    }, inputType);
  expect(await offer("deleteContent")).toBe(true);
  expect((await modelText(page))[6]).toBe("last line");
  expect(await offer("deleteContentBackward")).toBe(true);
  await expect.poll(async () => (await modelText(page))[6]).toBe("line");
});
