import type { Page } from "@playwright/test";
import { test, expect, extensionId, statusText, activateAtStart, ready } from "./extension";

// The targets Plugin (DESIGN.md "Plugins"), end to end: its toggle in the
// options page, real keys on the textarea fixture, the value the page sees.
// A toggle applies at the next Activation, the rule the vimrc follows.

async function setTargets(page: Page, on: boolean): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/options/options.html`);
  await page.locator("#plugin-targets").setChecked(on);
  await expect(page.locator("#plugin-targets")).toBeChecked({ checked: on });
}

/** Opens the fixture Activated, with a pair of parentheses typed at the end of the first line and the cursor back at its start. */
async function openActivatedWithPair(page: Page): Promise<void> {
  await page.goto("/textarea.html");
  await ready(page);
  await activateAtStart(page, "#ta");
  await page.keyboard.type("A (fox)");
  await page.keyboard.press("Escape");
  await page.keyboard.type("0");
  await expect(page.locator("#ta")).toHaveValue(/^the quick brown fox \(fox\)\n/);
}

test("toggled on, cin( typed as real keys changes inside the next pair", async ({ page }) => {
  await setTargets(page, true);
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
  await setTargets(page, true);
  await setTargets(page, false);
  await openActivatedWithPair(page);
  const ta = page.locator("#ta");
  await page.keyboard.type("cin(");
  await expect(ta).toHaveValue(/^the quick brown fox \(fox\)\n/);
  expect(await statusText(page)).toContain("NORMAL");
});
