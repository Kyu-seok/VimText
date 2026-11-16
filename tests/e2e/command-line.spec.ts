import { test, expect, statusText, ready, activateAtStart, blockTexts, hostCount } from "./extension";
import type { Page } from "@playwright/test";

/**
 * VimText's own command line is never a Field (#78): the `:` `/` `?` input
 * lives in the Status Line's shadow root, where the document capture listener
 * sees its keys first. Esc there closes the command line and focuses the Field
 * again in Normal mode, rather than Activating a second Session on the input.
 *
 * Coverage (CODING_STANDARDS rule 5): a textarea, a Single-line Field and a
 * contenteditable; the command line opened from Normal mode with each prompt.
 * Insert and Replace mode type `:` as text, so they never open it. From Visual
 * mode, Esc closes the `:'<,'>` prompt and the engine stays in Visual
 * (`processEx`'s `onPromptKeyDown`, which Vim does not do): an engine semantic,
 * upstream's (CODING_STANDARDS rule 3), so not asserted here.
 */

const fields = [
  {
    name: "textarea",
    url: "/textarea.html",
    selector: "#ta",
    firstLine: async (page: Page) => (await page.locator("#ta").inputValue()).split("\n")[0],
    afterX: "he quick brown fox",
  },
  {
    name: "Single-line Field",
    url: "/single-line.html",
    selector: "#in",
    firstLine: (page: Page) => page.locator("#in").inputValue(),
    afterX: "ello world",
  },
  {
    name: "contenteditable",
    url: "/contenteditable.html",
    selector: "#ce",
    firstLine: async (page: Page) => (await blockTexts(page, "#ce"))[0],
    afterX: "he quick brown fox",
  },
];

for (const field of fields) {
  for (const prompt of [":", "/", "?"]) {
    test(`${field.name}: Esc in the ${prompt} command line closes it and the Field is in Normal mode`, async ({
      page,
    }) => {
      await page.goto(field.url);
      await ready(page);
      await activateAtStart(page, field.selector);
      await page.keyboard.press(prompt);
      await expect.poll(() => statusText(page)).toContain(prompt);
      await page.keyboard.press("Escape");
      await expect.poll(() => statusText(page)).toContain("NORMAL");
      expect(await hostCount(page)).toBe(1);
      // The next key acts on the Field: `x` deletes the first character.
      await page.keyboard.press("x");
      await expect.poll(() => field.firstLine(page)).toBe(field.afterX);
      expect(await hostCount(page)).toBe(1);
    });
  }
}
