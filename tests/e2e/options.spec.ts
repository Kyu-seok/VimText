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
