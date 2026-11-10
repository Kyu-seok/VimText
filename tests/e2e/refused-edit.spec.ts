import { test, expect, statusText, ready, activateAtStart, blockTexts, selectedText } from "./extension";

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
  expect(await blockTexts(page, "#ce")).toEqual(ORIGINAL);
  expect(await selectedText(page)).toBe("L");
  expect(await statusText(page)).toContain(REFUSED);
});

test("the next key works, an accepted edit beside the refused one lands, and u undoes only that", async ({
  page,
}) => {
  await page.keyboard.type("x");
  expect(await blockTexts(page, "#ce")).toEqual(["bLOCKcd", "next line"]);
  await page.keyboard.type("lx");
  expect(await blockTexts(page, "#ce")).toEqual(["bLOCKcd", "next line"]);
  await page.keyboard.type("l");
  expect(await selectedText(page)).toBe("O");
  await page.keyboard.type("u");
  expect(await blockTexts(page, "#ce")).toEqual(ORIGINAL);
  await page.keyboard.type("$x");
  expect(await blockTexts(page, "#ce")).toEqual(["abLOCKc", "next line"]);
});
