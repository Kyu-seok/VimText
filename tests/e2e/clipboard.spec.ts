import { test, expect, activateAtStart, ready, fixtureOrigin } from "./extension";

// The clipboard registers in a content script under the manifest's
// clipboardRead/clipboardWrite permissions (DESIGN.md "Registers & clipboard").
// The page is the other party: it reads what a yank left on the clipboard and
// writes what a paste should take from it.

test.beforeEach(async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: fixtureOrigin });
  await page.goto("/textarea.html");
  await ready(page);
  await activateAtStart(page, "#ta");
});

test('"+yiw puts the word on the system clipboard', async ({ page }) => {
  await page.keyboard.type('"+yiw');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("the");
});

test('"*yiw puts the word on the system clipboard too', async ({ page }) => {
  await page.keyboard.type('w"*yiw');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("quick");
});

test('"+p pastes what the page put on the clipboard', async ({ page }) => {
  await page.evaluate(() => navigator.clipboard.writeText("CLIP"));
  await page.keyboard.type('"+p');
  await expect(page.locator("#ta")).toHaveValue(/^tCLIPhe quick/);
});

test('"*P pastes from the clipboard as "+p does', async ({ page }) => {
  await page.evaluate(() => navigator.clipboard.writeText("STAR"));
  await page.keyboard.type('"*P');
  await expect(page.locator("#ta")).toHaveValue(/^STARthe quick/);
});
