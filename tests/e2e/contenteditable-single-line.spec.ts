import { test, expect, statusText, ready, activateAtStart, blockTexts } from "./extension";

/**
 * A contenteditable that declares `aria-multiline="false"` is a Single-line
 * Field (#49) through the built extension: the title host takes the rules an
 * input does, the same host without the attribute keeps multi-line behaviour.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/contenteditable-single-line.html");
  await ready(page);
});

test("Enter in Normal submits the form; with a pending operator it does not", async ({ page }) => {
  await activateAtStart(page, "#title");
  await page.keyboard.type("d");
  await page.keyboard.press("Enter");
  await expect(page.locator("#log")).not.toContainText("submit");
  await page.keyboard.press("Enter");
  await expect(page.locator("#log")).toContainText("submit");
  await expect.poll(() => blockTexts(page, "#title")).toEqual(["hello world"]);
});

test("o and O beep; yyp concatenates and u restores", async ({ page }) => {
  await activateAtStart(page, "#title");
  await page.keyboard.type("oO");
  await expect.poll(() => statusText(page)).toContain("NORMAL");
  await expect.poll(() => blockTexts(page, "#title")).toEqual(["hello world"]);
  await page.keyboard.type("yyp");
  await expect.poll(() => blockTexts(page, "#title")).toEqual(["hello worldhello world"]);
  await page.keyboard.type("u");
  await expect.poll(() => blockTexts(page, "#title")).toEqual(["hello world"]);
});

test("the same host without the attribute: yyp pastes a line, o opens one, Enter is a motion", async ({
  page,
}) => {
  await activateAtStart(page, "#body");
  await page.keyboard.type("yyp");
  await expect.poll(() => blockTexts(page, "#body")).toEqual(["hello world", "hello world"]);
  await page.keyboard.type("gg");
  await page.keyboard.press("Enter");
  await page.keyboard.type("onew");
  await expect.poll(() => blockTexts(page, "#body")).toEqual(["hello world", "hello world", "new"]);
  await expect(page.locator("#log")).not.toContainText("submit");
});

test("on a host whose page does not handle Enter, Enter in Normal edits nothing: w Enter x deletes w", async ({
  page,
}) => {
  await activateAtStart(page, "#bare");
  await page.keyboard.type("w");
  await page.keyboard.press("Enter");
  await page.keyboard.type("x");
  await expect.poll(() => blockTexts(page, "#bare")).toEqual(["hello orld"]);
  await expect(page.locator("#log")).not.toContainText("insertParagraph");
});

test("on a host whose page does not handle Enter, u after Enter undoes the edit before it", async ({
  page,
}) => {
  await activateAtStart(page, "#bare");
  await page.keyboard.type("x");
  await expect.poll(() => blockTexts(page, "#bare")).toEqual(["ello world"]);
  await page.keyboard.press("Enter");
  await page.keyboard.type("u");
  await expect.poll(() => blockTexts(page, "#bare")).toEqual(["hello world"]);
});

test("on a host whose page does not handle Enter, Enter in Insert is still the browser's", async ({
  page,
}) => {
  await activateAtStart(page, "#bare");
  await page.keyboard.type("i");
  await expect.poll(() => statusText(page)).toContain("INSERT");
  await page.keyboard.press("Enter");
  await expect(page.locator("#log")).toContainText("input:insertParagraph");
});
