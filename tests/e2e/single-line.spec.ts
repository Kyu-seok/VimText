import { test, expect, statusText } from "./extension";

test.beforeEach(async ({ page }) => {
  await page.goto("/single-line.html");
  await page.waitForTimeout(150); // content script runs at document_idle
});

test("Enter submits in Normal, j/k are no-ops", async ({ page }) => {
  const input = page.locator("#in");
  await input.focus();
  await page.keyboard.press("Escape");
  await page.keyboard.type("0jkdw");
  await expect(input).toHaveValue("world");
  await page.keyboard.press("Enter");
  await expect(page.locator("#log")).toContainText("submit");
});

test("Enter with a pending operator goes to the engine and does not submit", async ({ page }) => {
  const input = page.locator("#in");
  await input.focus();
  await page.keyboard.press("Escape");
  await page.keyboard.type("d");
  await page.keyboard.press("Enter");
  await page.keyboard.type("x");
  await expect(input).toHaveValue("ello world");
  await expect(page.locator("#log")).not.toContainText("submit");
});

test("o does not enter Insert; yyp concatenates and u restores", async ({ page }) => {
  const input = page.locator("#in");
  await input.focus();
  await page.keyboard.press("Escape");
  await page.keyboard.type("o");
  expect(await statusText(page)).toContain("NORMAL");
  await expect(input).toHaveValue("hello world");
  await page.keyboard.type("yyp");
  await expect(input).toHaveValue("hello worldhello world");
  await page.keyboard.type("u");
  await expect(input).toHaveValue("hello world");
});

test("2nd Esc on a search input clears it (Chrome) and u brings the text back", async ({ page }) => {
  const search = page.locator("#search");
  await search.focus();
  await page.keyboard.press("Escape");
  expect(await statusText(page)).toContain("NORMAL");
  await page.keyboard.press("Escape");
  await expect(page.locator("#log")).toContainText("page-esc");
  await expect(search).toHaveValue("");
  await page.keyboard.type("u");
  await expect(search).toHaveValue("find me");
});

test("Tab moves focus", async ({ page }) => {
  await page.locator("#in").focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  await expect(page.locator("#search")).toBeFocused();
});
