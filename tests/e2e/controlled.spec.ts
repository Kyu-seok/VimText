import { test, expect } from "./extension";

test.beforeEach(async ({ page }) => {
  await page.goto("/controlled.html");
  await page.waitForTimeout(150); // content script runs at document_idle
});

test("synchronous rewrite: x keeps the page's uppercase text, one u restores the original, . repeats", async ({
  page,
}) => {
  const input = page.locator("#upper");
  await input.focus();
  await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(0, 0));
  await page.keyboard.press("Escape");
  await page.keyboard.type("x");
  await expect(input).toHaveValue("ELLO WORLD");
  await page.keyboard.type("u");
  // The original, in the page's form: an uppercase filter has no way to show lowercase.
  await expect(input).toHaveValue("HELLO WORLD");
  // The page's rewrite of the restored text is a new history event (it clears
  // redo), and each further u undoes it only to be rewritten again: the value
  // is stable under repeated u only because the filter is idempotent.
  await page.keyboard.type("u");
  await expect(input).toHaveValue("HELLO WORLD");
  // The page parked the caret at the end on that write (where `el.value = …` leaves it), so go back first.
  await page.keyboard.type("0.");
  await expect(input).toHaveValue("ELLO WORLD");
});

test("synchronous rewrite: the length cap holds against a paste", async ({ page }) => {
  const input = page.locator("#upper");
  await input.focus();
  await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(0, 0));
  await page.keyboard.press("Escape");
  await page.keyboard.type("yiwP");
  await expect(input).toHaveValue("HELLOHELLO W");
  await page.keyboard.type("u");
  await expect(input).toHaveValue("HELLO WORLD");
});

test("setTimeout rewrite: the text is the page's (undo churns, by the decision record on issue #9)", async ({
  page,
}) => {
  const input = page.locator("#later");
  await input.focus();
  await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(0, 0));
  await page.keyboard.press("Escape");
  await page.keyboard.type("x");
  await expect(input).toHaveValue("ELLO WORLD");
  await page.keyboard.type("u");
  // The rewrite is its own undo step: u undoes it, the page reformats again.
  await expect(input).toHaveValue("ELLO WORLD");
});
