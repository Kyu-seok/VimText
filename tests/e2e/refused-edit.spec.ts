import { test, expect, statusText, ready, activateAtStart, blockTexts, selectedText } from "./extension";
import type { Page } from "@playwright/test";

/**
 * An edit the editor refuses (#48) through the built extension: the fixture's
 * editor puts its markup back from its `input` handler when an edit touches
 * its locked span. The Field wins, the Status Line says so, and `u` walks past
 * the change that never happened.
 */

const ORIGINAL = ["abLOCKcd", "next line"];
const REFUSED = "VimText: the page refused the edit";

test.beforeEach(async ({ page }) => {
  await page.goto("/refused-edit.html");
  await ready(page);
  await activateAtStart(page, "#ce");
});

test("x on the locked span is refused: the text stays, the cursor stays, the Status Line says so", async ({
  page,
}) => {
  await page.keyboard.type("ll");
  await page.keyboard.type("x");
  await expect.poll(() => blockTexts(page, "#ce")).toEqual(ORIGINAL);
  await expect.poll(() => selectedText(page)).toBe("L");
  await expect.poll(() => statusText(page)).toContain(REFUSED);
});

test("the next key works, an accepted edit beside the refused one lands, and u undoes only that", async ({
  page,
}) => {
  await page.keyboard.type("x");
  await expect.poll(() => blockTexts(page, "#ce")).toEqual(["bLOCKcd", "next line"]);
  await page.keyboard.type("lx");
  await expect.poll(() => blockTexts(page, "#ce")).toEqual(["bLOCKcd", "next line"]);
  await page.keyboard.type("l");
  await expect.poll(() => selectedText(page)).toBe("O");
  await page.keyboard.type("u");
  await expect.poll(() => blockTexts(page, "#ce")).toEqual(ORIGINAL);
  await page.keyboard.type("$x");
  await expect.poll(() => blockTexts(page, "#ce")).toEqual(["abLOCKc", "next line"]);
});

interface Offered {
  inputType: string;
  data: string | null;
  trusted: boolean;
  target: string | null;
  inHost: boolean;
}

function offered(page: Page): Promise<Offered[]> {
  return page.evaluate(() => (window as unknown as { offered: Offered[] }).offered);
}

/**
 * Each write step is offered to the page as a synthetic `beforeinput` before
 * any editing command runs (ADR 0008). Dispatched from the content script's
 * isolated world, it reaches the page's own listener as an `InputEvent` whose
 * `getTargetRanges()` is a `StaticRange` over the page's nodes, and the page's
 * `preventDefault` reads back in the content script: the command does not run,
 * the text stays, and the Status Line says the page refused the edit
 * (docs/engine-seams.md, "beforeinput from the isolated world").
 */
test("a page that cancels beforeinput and does nothing refuses the edit; it saw each step's type, text and target range", async ({
  page,
}) => {
  await page.reload();
  await ready(page);
  await activateAtStart(page, "#cancel");
  await page.keyboard.type("x");
  await expect.poll(() => statusText(page)).toContain(REFUSED);
  await page.keyboard.type("wrZ");
  await expect.poll(async () => (await offered(page)).length).toBe(2);
  await expect.poll(() => statusText(page)).toContain(REFUSED);
  expect(await blockTexts(page, "#cancel")).toEqual(["hello world"]);
  expect(await offered(page)).toEqual([
    { inputType: "deleteContentBackward", data: null, trusted: false, target: "h", inHost: true },
    { inputType: "insertText", data: "Z", trusted: false, target: "w", inHost: true },
  ]);
});
