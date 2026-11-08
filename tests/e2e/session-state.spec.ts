import type { Page } from "@playwright/test";
import { test, expect, activateAtStart, ready } from "./extension";

// Session State crosses tabs through session storage (DESIGN.md "Session
// State"): the service worker grants content scripts access, every tab writes
// after the key that changed its registers, every other tab restores before
// its next key. The second tab is a second page of the same persistent context.

async function openActivated(page: Page): Promise<void> {
  await page.goto("/textarea.html");
  await ready(page);
  await activateAtStart(page, "#ta");
}

test("a yank in one tab is pastable in another", async ({ context, page }) => {
  const other = await context.newPage();
  await openActivated(page);
  await openActivated(other);
  await page.keyboard.type("yiw");
  await other.bringToFront();
  await other.locator("#ta").focus();
  // The write and the other tab's restore are asynchronous: poll the paste.
  await expect
    .poll(async () => {
      await other.keyboard.type("P");
      return other.locator("#ta").inputValue();
    })
    .toMatch(/^the(the)*the quick/);
  await other.close();
});

test("a macro recorded in one tab runs in another", async ({ context, page }) => {
  const other = await context.newPage();
  await openActivated(page);
  await openActivated(other);
  await page.keyboard.type("qqxq");
  await expect(page.locator("#ta")).toHaveValue(/^he quick/);
  await other.bringToFront();
  await other.locator("#ta").focus();
  await expect
    .poll(async () => {
      await other.keyboard.type("@q");
      return other.locator("#ta").inputValue();
    })
    .toMatch(/^(he |e | |)quick/);
  await other.close();
});

// The command line commits its history on Enter inside the Status Line's own
// input, after the keydown has passed the document: the write must still see it.

test("an ex command run in one tab is what : and Up recall in another", async ({ context, page }) => {
  const other = await context.newPage();
  await openActivated(page);
  await openActivated(other);
  await page.keyboard.type(":s/the/THE/");
  await page.keyboard.press("Enter");
  await expect(page.locator("#ta")).toHaveValue(/^THE quick/);
  await other.bringToFront();
  await other.locator("#ta").focus();
  await expect
    .poll(async () => {
      await other.keyboard.press(":");
      await other.keyboard.press("ArrowUp");
      await other.keyboard.press("Enter");
      return other.locator("#ta").inputValue();
    })
    .toMatch(/^THE quick/);
  await other.close();
});

test("a search run in one tab is what / and Up recall in another", async ({ context, page }) => {
  const other = await context.newPage();
  await openActivated(page);
  await openActivated(other);
  await page.keyboard.type("/quick");
  await page.keyboard.press("Enter");
  await other.bringToFront();
  await other.locator("#ta").focus();
  // Recalling the search lands the cursor on "quick"; an empty history leaves it at the start.
  await expect
    .poll(async () => {
      await other.keyboard.press("0");
      await other.keyboard.press("/");
      await other.keyboard.press("ArrowUp");
      await other.keyboard.press("Enter");
      return other.locator("#ta").evaluate((el: HTMLTextAreaElement) => el.selectionStart);
    })
    .toBe(4);
  await other.keyboard.press("x");
  await expect(other.locator("#ta")).toHaveValue(/^the uick/);
  await other.close();
});
