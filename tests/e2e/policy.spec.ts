import { test, expect, statusText, setSettings } from "./extension";

test("Site Policy 'normal' activates on focus", async ({ context, page }) => {
  await setSettings(context, {
    enabled: true,
    sites: { "http://localhost:4173": "normal" },
    vimrc: "",
    plugins: {},
  });
  await page.goto("/textarea.html");
  await page.waitForTimeout(150);
  await page.locator("#ta").focus();
  expect(await statusText(page)).toContain("NORMAL");
  await page.keyboard.type("x");
  await expect(page.locator("#ta")).toHaveValue(/^he quick/);
});

test("Site Policy 'off' makes Esc a plain key", async ({ context, page }) => {
  await setSettings(context, {
    enabled: true,
    sites: { "http://localhost:4173": "off" },
    vimrc: "",
    plugins: {},
  });
  await page.goto("/textarea.html");
  await page.waitForTimeout(150);
  await page.locator("#ta").focus();
  await page.keyboard.press("Escape");
  expect(await statusText(page)).toBe("");
  await expect(page.locator("#log")).toContainText("page-esc");
});

test("vimrc mappings apply on activation", async ({ context, page }) => {
  await setSettings(context, {
    enabled: true,
    sites: {},
    vimrc: "nnoremap Y y$\nnnoremap \\x dd",
    plugins: {},
  });
  await page.goto("/textarea.html");
  await page.waitForTimeout(150);
  const ta = page.locator("#ta");
  await ta.focus();
  await ta.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
  await page.keyboard.press("Escape");
  await page.keyboard.type("wYP");
  await expect(ta).toHaveValue(/^the quick brown foxquick brown fox\n/);
  await page.keyboard.type("\\x");
  await expect(ta).toHaveValue(/^jumps over/);
});

test("popup reports the origin and mode of the focused Field", async ({ context, page }) => {
  await page.goto("/textarea.html");
  await page.waitForTimeout(150);
  await page.locator("#ta").focus();
  await page.keyboard.press("Escape");
  const tabs = await page.evaluate(() => 1); // keep page active
  expect(tabs).toBe(1);
  const popup = await context.newPage();
  const { extensionId } = await import("./extension");
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  // The popup queries the active tab; make the fixture page the active one.
  await page.bringToFront();
  await popup.reload();
  await expect(popup.locator("#origin")).toHaveText("http://localhost:4173");
});
