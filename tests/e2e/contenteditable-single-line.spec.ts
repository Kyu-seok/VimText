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
  expect(await blockTexts(page, "#title")).toEqual(["hello world"]);
});

test("o and O beep; yyp concatenates and u restores", async ({ page }) => {
  await activateAtStart(page, "#title");
  await page.keyboard.type("oO");
  expect(await statusText(page)).toContain("NORMAL");
  expect(await blockTexts(page, "#title")).toEqual(["hello world"]);
  await page.keyboard.type("yyp");
  expect(await blockTexts(page, "#title")).toEqual(["hello worldhello world"]);
  await page.keyboard.type("u");
  expect(await blockTexts(page, "#title")).toEqual(["hello world"]);
});

test("the same host without the attribute: yyp pastes a line, o opens one, Enter is a motion", async ({
  page,
}) => {
  await activateAtStart(page, "#body");
  await page.keyboard.type("yyp");
  expect(await blockTexts(page, "#body")).toEqual(["hello world", "hello world"]);
  await page.keyboard.type("gg");
  await page.keyboard.press("Enter");
  await page.keyboard.type("onew");
  expect(await blockTexts(page, "#body")).toEqual(["hello world", "hello world", "new"]);
  await expect(page.locator("#log")).not.toContainText("submit");
});
