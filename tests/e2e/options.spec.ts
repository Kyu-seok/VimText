import { test, expect, extensionId } from "./extension";

// The options page runs a saved vimrc through the engine and lists the lines
// that fail under the text box (DESIGN.md "Settings"); a clean save lists nothing.

test("saving a vimrc with a bad line lists that line and the engine's error; a clean save lists nothing", async ({
  page,
}) => {
  await page.goto(`chrome-extension://${extensionId}/options/options.html`);
  const errors = page.locator("#vimrc-errors li");
  await page.locator("#vimrc").fill("nnoremap Y y$\nnotacommand foo");
  await page.locator("#save-vimrc").click();
  await expect(page.locator("#vimrc-status")).toContainText("Saved");
  await expect(errors).toHaveCount(1);
  await expect(errors.first()).toContainText("line 2");
  await expect(errors.first()).toContainText('Not an editor command ":notacommand foo"');

  await page.locator("#vimrc").fill("nnoremap Y y$");
  await page.locator("#save-vimrc").click();
  await expect(page.locator("#vimrc-status")).toContainText("Saved");
  await expect(errors).toHaveCount(0);
});

test("a saved vimrc with a bad line shows its error on the next open of the options page", async ({
  page,
}) => {
  await page.goto(`chrome-extension://${extensionId}/options/options.html`);
  await page.locator("#vimrc").fill("set nosuchoption");
  await page.locator("#save-vimrc").click();
  await expect(page.locator("#vimrc-status")).toContainText("Saved");
  await page.reload();
  await expect(page.locator("#vimrc")).toHaveValue("set nosuchoption");
  await expect(page.locator("#vimrc-errors li")).toHaveCount(1);
  await expect(page.locator("#vimrc-errors li").first()).toContainText("Unknown option: suchoption");
});

// The Monaco Field's setting (ADR 0010; #113, Q7 and Q19): one checkbox, off
// until the person switches it on.

test.describe("the Monaco code editors checkbox", () => {
  const stored = (page: import("@playwright/test").Page) =>
    page.evaluate(
      async () => (await chrome.storage.sync.get("settings"))["settings"] as { monaco?: boolean },
    );

  test("is off for a fresh profile, marked experimental, with the note about the site's own Vim mode", async ({
    page,
  }) => {
    await page.goto(`chrome-extension://${extensionId}/options/options.html`);
    const box = page.getByLabel("Vim in Monaco code editors");
    await expect(box).not.toBeChecked();
    await expect(page.locator("label", { has: box })).toContainText("experimental");
    await expect(page.locator("#monaco-field-note")).toContainText("Turn off the site's own Vim mode");
  });

  test("is off for settings stored before it existed, and the other settings are kept", async ({ page }) => {
    await page.goto(`chrome-extension://${extensionId}/options/options.html`);
    // What 0.4.3 stored: no `monaco` key.
    await page.evaluate(() =>
      chrome.storage.sync.set({
        settings: {
          enabled: true,
          sites: {},
          vimrc: "nnoremap Y y$",
          plugins: { surround: true, targets: false },
        },
      }),
    );
    await page.reload();
    await expect(page.locator("#vimrc")).toHaveValue("nnoremap Y y$");
    await expect(page.locator("#plugin-surround")).toBeChecked();
    await expect(page.getByLabel("Vim in Monaco code editors")).not.toBeChecked();
  });

  test("switched on it is stored and still on at the next open; switched off it is stored off", async ({
    page,
  }) => {
    await page.goto(`chrome-extension://${extensionId}/options/options.html`);
    const box = page.getByLabel("Vim in Monaco code editors");
    await box.check();
    await expect.poll(async () => (await stored(page))?.monaco).toBe(true);
    await page.reload();
    await expect(box).toBeChecked();
    await box.uncheck();
    await expect.poll(async () => (await stored(page))?.monaco).toBe(false);
  });
});
