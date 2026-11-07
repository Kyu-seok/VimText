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

  test("setting readonly disposes the Session so keys go native; clearing it lets Esc activate anew", async ({
    page,
  }) => {
    const input = page.locator("#in");
    const log = page.locator("#log");
    await input.focus();
    await page.keyboard.press("Escape");
    expect(await statusText(page)).toContain("NORMAL");
    await input.evaluate((el: HTMLInputElement) => (el.readOnly = true));
    await expect.poll(() => hostCount(page)).toBe(0);
    await page.keyboard.press("Escape"); // native: the page sees it, VimText shows nothing
    await expect(log).toContainText("page-esc");
    expect(await statusText(page)).toBe("");
    await input.evaluate((el: HTMLInputElement) => (el.readOnly = false));
    await page.keyboard.press("Escape");
    expect(await statusText(page)).toContain("NORMAL");
    await page.keyboard.type("0x");
    await expect(input).toHaveValue("ello world");
  });

  test("a password input qualifies once a 'show password' toggle reveals it as text", async ({ page }) => {
    const pw = page.locator("#pw");
    const log = page.locator("#log");
    await pw.focus();
    await page.keyboard.press("Escape"); // secret text is never a Field: native
    await expect(log).toContainText("page-esc");
    expect(await statusText(page)).toBe("");
    await page.evaluate(() => document.getElementById("showpw")!.click());
    await expect(pw).toHaveAttribute("type", "text");
    await page.keyboard.press("Escape");
    expect(await statusText(page)).toContain("NORMAL");
    await page.keyboard.type("0x");
    await expect(pw).toHaveValue("3cret");
    // Hidden again: the Session goes and keys are native once more (a native
    // "x" replaces the block cursor's leftover selection; Normal "x" would delete it).
    await page.evaluate(() => document.getElementById("showpw")!.click());
    await expect.poll(() => hostCount(page)).toBe(0);
    await page.keyboard.type("x");
    await expect(pw).toHaveValue("xcret");
  });
});

test.describe("React fixture", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/react.html");
    await page.waitForTimeout(150);
    await expect(page.locator("#in")).toHaveValue("the quick brown fox"); // React mounted
  });

  async function activateAtStart(page: Page): Promise<void> {
    const input = page.locator("#in");
    await input.focus();
    await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(0, 0));
    await page.keyboard.press("Escape");
    expect(await statusText(page)).toContain("NORMAL");
  }

  test("a re-mounted input is a new Field in the Start Mode with no undo history", async ({ page }) => {
    const input = page.locator("#in");
    await activateAtStart(page);
    await page.keyboard.type("x");
    await expect(input).toHaveValue("he quick brown fox");
    // React replaces the element for a new key; the old Field's Session goes with it.
    await page.evaluate(() => document.getElementById("remount")!.click());
    await expect(page.locator("#mount")).toHaveText("2");
    await expect.poll(() => hostCount(page)).toBe(0);
    // The new element is inert until Esc (Start Mode Insert for an unknown origin)…
    await input.focus();
    expect(await statusText(page)).toBe("");
    await page.keyboard.type("!");
    await expect(input).toHaveValue("he quick brown fox!");
    // …and once activated it remembers nothing of the old Field: `u` has nothing to undo.
    await page.keyboard.press("Escape");
    expect(await statusText(page)).toContain("NORMAL");
    await page.keyboard.type("u");
    await expect(input).toHaveValue("he quick brown fox!");
    await expect(page.locator("#state")).toHaveText("he quick brown fox!");
  });

  test("React setting readOnly disposes the Session; clearing it lets Esc activate anew", async ({
    page,
  }) => {
    const input = page.locator("#in");
    await activateAtStart(page);
    await page.evaluate(() => document.getElementById("readonly")!.click());
    await expect(input).toHaveAttribute("readonly", "");
    await expect.poll(() => hostCount(page)).toBe(0);
    await page.keyboard.type("x"); // native on a readonly input: nothing happens
    await expect(input).toHaveValue("the quick brown fox");
    expect(await statusText(page)).toBe("");
    await page.evaluate(() => document.getElementById("readonly")!.click());
    await expect(input).not.toHaveAttribute("readonly");
    await page.keyboard.press("Escape");
    expect(await statusText(page)).toContain("NORMAL");
    await page.keyboard.type("0x"); // the fresh Field starts from the caret the page has
    await expect(input).toHaveValue("he quick brown fox");
    await expect(page.locator("#state")).toHaveText("he quick brown fox");
  });
});
