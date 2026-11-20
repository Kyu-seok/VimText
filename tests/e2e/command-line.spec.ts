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
    afterWX: "the uick brown fox",
    afterVeX: "the  brown fox",
  },
  {
    name: "Single-line Field",
    url: "/single-line.html",
    selector: "#in",
    firstLine: (page: Page) => page.locator("#in").inputValue(),
    afterX: "ello world",
    afterWX: "hello orld",
    afterVeX: "hello ",
  },
  {
    name: "contenteditable",
    url: "/contenteditable.html",
    selector: "#ce",
    firstLine: async (page: Page) => (await blockTexts(page, "#ce"))[0],
    afterX: "he quick brown fox",
    afterWX: "the uick brown fox",
    afterVeX: "the  brown fox",
  },
];

/** Whether the Field itself has focus again, not the command line or nothing. */
function focused(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).evaluate((el) => document.activeElement === el);
}

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

/**
 * Closing the command line leaves the Cursor where it was (#88). The engine
 * focuses the Field again as its dialog closes, and that focus puts a
 * contenteditable host's caret at its start: not the person's caret move.
 * Each test moves off the Field's start first (`w`), where the tests above
 * cannot tell a Cursor moved to offset 0 from one left alone.
 *
 * Coverage (CODING_STANDARDS rule 5): Normal mode on a textarea, a Single-line
 * Field and a contenteditable, closed by Esc from each prompt and by Enter
 * (`:noh`, an ex command that moves nothing; a submitted `:s` puts the Cursor
 * on its match itself, so it cannot show the jump); Visual mode below.
 * A contenteditable inside an open shadow root: `shadow-contenteditable.spec.ts`;
 * the four rich editors, each in its own spec. Not covered: a command line
 * whose Enter ends in a notice with no dialog between (a search that finds
 * nothing, an unknown ex command), after which no Field has focus at all.
 */
const closings = [
  { name: "Esc in the : command line", keys: [":", "Escape"] },
  { name: "Esc in the / command line", keys: ["/", "Escape"] },
  { name: "Esc in the ? command line", keys: ["?", "Escape"] },
  { name: "Enter on :noh", keys: [":", "n", "o", "h", "Enter"] },
];

for (const field of fields) {
  for (const closing of closings) {
    test(`${field.name}: ${closing.name} leaves the Cursor where it was`, async ({ page }) => {
      await page.goto(field.url);
      await ready(page);
      await activateAtStart(page, field.selector);
      await page.keyboard.press("w");
      const prompt = closing.keys[0]!;
      await page.keyboard.press(prompt);
      await expect.poll(() => statusText(page)).toContain(prompt);
      for (const key of closing.keys.slice(1)) await page.keyboard.press(key);
      await expect.poll(() => focused(page, field.selector)).toBe(true);
      // `x` deletes the character `w` moved to, the second word's first.
      await page.keyboard.press("x");
      await expect.poll(() => field.firstLine(page)).toBe(field.afterWX);
    });
  }
}

/**
 * From Visual mode the engine stays in Visual when Esc closes the `:'<,'>`
 * prompt (DESIGN.md "Accepted limitations", #81), so the selection held
 * before `:` is the one the next key acts on, on every Field (#88: a
 * contenteditable came back in Normal mode, the Cursor at its start).
 */
for (const field of fields) {
  test(`${field.name}: Esc in the : command line opened from Visual mode leaves the selection it held`, async ({
    page,
  }) => {
    await page.goto(field.url);
    await ready(page);
    await activateAtStart(page, field.selector);
    for (const key of ["w", "v", "e", ":"]) await page.keyboard.press(key);
    await expect.poll(() => statusText(page)).toContain(":");
    await page.keyboard.press("Escape");
    await expect.poll(() => focused(page, field.selector)).toBe(true);
    // `x` deletes the second word, which `ve` selected.
    await page.keyboard.press("x");
    await expect.poll(() => field.firstLine(page)).toBe(field.afterVeX);
  });
}

/**
 * The page may change the Field while the command line is open. The text is
 * the Field's (CODING_STANDARDS rule 1), but the caret the engine's focus
 * leaves at the host's start is still not the person's: the Cursor stays on
 * its character (#88).
 */
test("contenteditable: Esc in the : command line leaves the Cursor where it was when the page changed the text meanwhile", async ({
  page,
}) => {
  await page.goto("/contenteditable.html");
  await ready(page);
  await activateAtStart(page, "#ce");
  await page.keyboard.press("w");
  await page.keyboard.press(":");
  await expect.poll(() => statusText(page)).toContain(":");
  await page.locator("#ce").evaluate((el) => (el.lastElementChild!.textContent += "!"));
  await page.keyboard.press("Escape");
  await expect.poll(() => statusText(page)).toContain("NORMAL");
  await page.keyboard.press("x");
  await expect.poll(async () => (await blockTexts(page, "#ce"))[0]).toBe("the uick brown fox");
  // The page's change stands.
  expect((await blockTexts(page, "#ce")).at(-1)).toMatch(/!$/);
});
