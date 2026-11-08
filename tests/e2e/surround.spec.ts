import { test, expect, statusText, setPlugin, openActivated } from "./extension";

// The surround Plugin (DESIGN.md "Plugins"), end to end: its toggle in the
// options page, real keys on the textarea fixture, the value the page sees.

test("toggled on, ysiw) and ds( typed as real keys change the value", async ({ page }) => {
  await setPlugin(page, "surround", true);
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
  await setPlugin(page, "surround", true);
  await setPlugin(page, "surround", false);
  await openActivated(page);
  const ta = page.locator("#ta");
  await page.keyboard.type("ds(");
  await expect(ta).toHaveValue(/^the quick brown fox\n/);
  expect(await statusText(page)).toContain("NORMAL");
  await page.keyboard.type("s");
  await expect(ta).toHaveValue(/^he quick brown fox\n/);
  expect(await statusText(page)).toContain("INSERT");
});
