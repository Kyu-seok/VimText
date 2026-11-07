import { test, expect, statusText } from "./extension";
import type { Page } from "@playwright/test";

// Disposal is prompt: a Session ends the moment its Field leaves the page or
// stops qualifying, not on the next focus change elsewhere (decision record #8).

/** How many Status Line hosts VimText has on the page; one per live Session. */
function hostCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll("vimtext-status").length);
}

test.describe("textarea fixture", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/textarea.html");
    await page.waitForTimeout(150); // content script runs at document_idle
  });

  test("removing the activated element removes the Status Line host without a focus change", async ({
    page,
  }) => {
    await page.locator("#ta").focus();
    await page.keyboard.press("Escape");
    expect(await statusText(page)).toContain("NORMAL");
    expect(await hostCount(page)).toBe(1);
    // Chrome fires no blur/focusin when the focused element is removed, so
    // nothing but prompt disposal can take the host away here.
    await page.evaluate(() => document.getElementById("ta")!.remove());
    await expect.poll(() => hostCount(page)).toBe(0);
  });
});
