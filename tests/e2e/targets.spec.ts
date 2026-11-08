import type { Page } from "@playwright/test";
import { test, expect, statusText, setPlugin, openActivated } from "./extension";

// The targets Plugin (DESIGN.md "Plugins"), end to end: its toggle in the
// options page, real keys on the textarea fixture, the value the page sees.

/** Opens the fixture Activated, with a pair of parentheses typed at the end of the first line and the cursor back at its start. */
async function openActivatedWithPair(page: Page): Promise<void> {
  await openActivated(page);
  await page.keyboard.type("A (fox)");
  await page.keyboard.press("Escape");
  await page.keyboard.type("0");
  await expect(page.locator("#ta")).toHaveValue(/^the quick brown fox \(fox\)\n/);
}

test("toggled on, cin( typed as real keys changes inside the next pair", async ({ page }) => {
  await setPlugin(page, "targets", true);
  await openActivatedWithPair(page);
  const ta = page.locator("#ta");
  await page.keyboard.type("cin(dog");
  await page.keyboard.press("Escape");
  await expect(ta).toHaveValue(/^the quick brown fox \(dog\)\n/);
  expect(await statusText(page)).toContain("NORMAL");
});

test("toggled off again, the same keys are the Baseline: i n is no text object, so c is cancelled, and ( is a motion", async ({
  page,
}) => {
  await setPlugin(page, "targets", true);
  await setPlugin(page, "targets", false);
  await openActivatedWithPair(page);
  const ta = page.locator("#ta");
  await page.keyboard.type("cin(");
  await expect(ta).toHaveValue(/^the quick brown fox \(fox\)\n/);
  expect(await statusText(page)).toContain("NORMAL");
});
