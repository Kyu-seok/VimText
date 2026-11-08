import type { Page } from "@playwright/test";
import { test, expect, extensionId, statusText, activateAtStart, ready } from "./extension";

// The surround Plugin (DESIGN.md "Plugins"), end to end: its toggle in the
// options page, real keys on the textarea fixture, the value the page sees.
// A toggle applies at the next Activation, the rule the vimrc follows.

async function setSurround(page: Page, on: boolean): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/options/options.html`);
  await page.locator("#plugin-surround").setChecked(on);
  await expect(page.locator("#plugin-surround")).toBeChecked({ checked: on });
}

async function openActivated(page: Page): Promise<void> {
  await page.goto("/textarea.html");
  await ready(page);
  await activateAtStart(page, "#ta");
}

test("toggled on, ysiw) and ds( typed as real keys change the value", async ({ page }) => {
  await setSurround(page, true);
  await openActivated(page);
  const ta = page.locator("#ta");
  await page.keyboard.type("wysiw)");
  await expect(ta).toHaveValue(/^the \(quick\) brown fox\n/);
  await page.keyboard.type("ds(");
  await expect(ta).toHaveValue(/^the quick brown fox\n/);
  expect(await statusText(page)).toContain("NORMAL");
});

test("toggled off again, the same keys are the Baseline: d s clears, ( moves, s substitutes", async ({
  page,
}) => {
  await setSurround(page, true);
  await setSurround(page, false);
  await openActivated(page);
  const ta = page.locator("#ta");
  await page.keyboard.type("ds(");
  await expect(ta).toHaveValue(/^the quick brown fox\n/);
  expect(await statusText(page)).toContain("NORMAL");
  await page.keyboard.type("s");
  await expect(ta).toHaveValue(/^he quick brown fox\n/);
  expect(await statusText(page)).toContain("INSERT");
});
