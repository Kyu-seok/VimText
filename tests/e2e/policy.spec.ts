import { test, expect, statusText, setSettings, fixtureOrigin } from "./extension";
import type { SitePolicy } from "../../src/settings/settings";

// Settings reach the content script asynchronously, so no spec here waits a
// fixed time for them: the arrival reconciles the focused Field (DESIGN.md
// "Settings"), and the specs poll for what the user would see.

function settingsWith(policy: SitePolicy | null, vimrc = ""): object {
  return { enabled: true, sites: policy ? { [fixtureOrigin]: policy } : {}, vimrc, plugins: {} };
}

test("Site Policy 'normal' Activates a Field on focus", async ({ context, page }) => {
  await setSettings(context, settingsWith("normal"));
  await page.goto("/textarea.html");
  await page.locator("#ta").focus();
  await expect.poll(() => statusText(page)).toContain("NORMAL");
  await page.keyboard.type("x");
  await expect(page.locator("#ta")).toHaveValue(/^he quick/);
});

test("Site Policy 'normal' Activates an autofocus Field with no focus action", async ({ context, page }) => {
  await setSettings(context, settingsWith("normal"));
  await page.goto("/autofocus.html");
  await expect.poll(() => statusText(page)).toContain("NORMAL");
  await page.keyboard.type("x");
  await expect(page.locator("#ta")).toHaveValue(/^he quick/);
});

test("switching the Site Policy to 'normal' Activates the focused Field without refocusing", async ({
  context,
  page,
}) => {
  await page.goto("/textarea.html");
  await page.locator("#ta").focus();
  expect(await statusText(page)).toBe("");
  await setSettings(context, settingsWith("normal"));
  await expect.poll(() => statusText(page)).toContain("NORMAL");
  await page.keyboard.type("x");
  await expect(page.locator("#ta")).toHaveValue(/^he quick/);
});

test("Site Policy 'off' leaves Esc to the page", async ({ context, page }) => {
  await setSettings(context, settingsWith("off"));
  await page.goto("/textarea.html");
  await page.locator("#ta").focus();
  await page.keyboard.press("Escape");
  expect(await statusText(page)).toBe("");
  await expect(page.locator("#log")).toContainText("page-esc");
});

test("vimrc mappings apply on activation", async ({ context, page }) => {
  await setSettings(context, settingsWith(null, "nnoremap Y y$\nnnoremap \\x dd"));
  await page.goto("/textarea.html");
  const ta = page.locator("#ta");
  await ta.focus();
  await ta.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
  await page.keyboard.press("Escape");
  await expect.poll(() => statusText(page)).toContain("NORMAL");
  await page.keyboard.type("wYP");
  await expect(ta).toHaveValue(/^the quick brown foxquick brown fox\n/);
  await page.keyboard.type("\\x");
  await expect(ta).toHaveValue(/^jumps over/);
});

test("popup reports the origin and mode of the focused Field", async ({ context, page }) => {
  await page.goto("/textarea.html");
  await page.locator("#ta").focus();
  await page.keyboard.press("Escape");
  await expect.poll(() => statusText(page)).toContain("NORMAL");
  const popup = await context.newPage();
  const { extensionId } = await import("./extension");
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  // The popup queries the active tab; make the fixture page the active one.
  await page.bringToFront();
  await popup.reload();
  await expect(popup.locator("#origin")).toHaveText(fixtureOrigin);
  await expect(popup.locator("#mode")).toHaveText("NORMAL");
});
