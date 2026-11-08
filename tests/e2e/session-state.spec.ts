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
