import { test, expect, statusText, activateAtStart, ready } from "./extension";
import type { Page } from "@playwright/test";

// A React 19 controlled input is a Controlled Field: React re-renders the
// input from its state after every edit. These tests prove that VimText's
// writes reach that state (the page's truth) and survive a re-render.

test.beforeEach(async ({ page }) => {
  await page.goto("/react.html");
  await ready(page);
  await expect(page.locator("#in")).toHaveValue("the quick brown fox"); // React mounted
});

/** Forces a state round-trip without moving focus (a real click would blur the Field). */
async function forceRerender(page: Page): Promise<void> {
  const before = Number(await page.locator("#renders").textContent());
  await page.evaluate(() => document.getElementById("rerender")!.click());
  await expect.poll(() => page.locator("#renders").textContent().then(Number)).toBeGreaterThan(before);
}

for (const [keys, expected] of [
  ["x", "he quick brown fox"],
  ["dw", "quick brown fox"],
  ["dwp", "qthe uick brown fox"],
] as const) {
  test(`Normal-mode '${keys}' sticks in the value and the rendered state across a re-render`, async ({
    page,
  }) => {
    const input = page.locator("#in");
    await activateAtStart(page);
    await page.keyboard.type(keys);
    await expect(input).toHaveValue(expected);
    await expect(page.locator("#state")).toHaveText(expected);
    await forceRerender(page);
    await expect(input).toHaveValue(expected);
    await expect(page.locator("#state")).toHaveText(expected);
    await expect(input).toBeFocused();
  });
}

test("typing in Insert before activation updates the rendered state", async ({ page }) => {
  const input = page.locator("#in");
  await input.focus();
  await input.evaluate((el: HTMLInputElement) => el.setSelectionRange(el.value.length, el.value.length));
  await page.keyboard.type("!");
  await expect(input).toHaveValue("the quick brown fox!");
  await expect(page.locator("#state")).toHaveText("the quick brown fox!");
});

test("typing in Insert after activation updates the rendered state and is undoable", async ({ page }) => {
  const input = page.locator("#in");
  await activateAtStart(page);
  await page.keyboard.type("A, said the dog");
  expect(await statusText(page)).toContain("INSERT");
  await expect(input).toHaveValue("the quick brown fox, said the dog");
  await expect(page.locator("#state")).toHaveText("the quick brown fox, said the dog");
  await page.keyboard.press("Escape");
  await forceRerender(page);
  await expect(input).toHaveValue("the quick brown fox, said the dog");
  await page.keyboard.type("u");
  await expect(input).toHaveValue("the quick brown fox");
  await expect(page.locator("#state")).toHaveText("the quick brown fox");
});
