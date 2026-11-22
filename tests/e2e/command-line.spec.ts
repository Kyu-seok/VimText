import {
  test,
  expect,
  statusText,
  ready,
  activateAtStart,
  blockTexts,
  hostCount,
  submitForNotice,
  focusedId,
  openActivated,
} from "./extension";
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
    afterVeExX: "the quic brown fox",
    afterWInsert: "the Zquick brown fox",
  },
  {
    name: "Single-line Field",
    url: "/single-line.html",
    selector: "#in",
    firstLine: (page: Page) => page.locator("#in").inputValue(),
    afterX: "ello world",
    afterWX: "hello orld",
    afterVeX: "hello ",
    afterVeExX: "hello worl",
    afterWInsert: "hello Zworld",
  },
  {
    name: "contenteditable",
    url: "/contenteditable.html",
    selector: "#ce",
    firstLine: async (page: Page) => (await blockTexts(page, "#ce"))[0],
    afterX: "he quick brown fox",
    afterWX: "the uick brown fox",
    afterVeX: "the  brown fox",
    afterVeExX: "the quic brown fox",
    afterWInsert: "the Zquick brown fox",
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
 * the four rich editors, each in its own spec. A command line whose Enter
 * ends in a notice: below.
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
 * A command line whose Enter ends in a notice gives the Field focus back too
 * (#90). The notice replaces the prompt, and the engine focuses the Field
 * then only when it finds `document.activeElement` inside the prompt, which
 * the Status Line's shadow root hides from it: focus was left on `<body>` and
 * the next key reached no Field.
 *
 * Coverage (CODING_STANDARDS rule 5): Normal mode on a textarea, a Single-line
 * Field and a contenteditable, for a search that finds nothing in each
 * direction, an unknown ex command, VimText's own `:w` notice, a `:s` and a
 * `:set` that fail, and a listing that waits for a key (`:registers`); Visual
 * mode, and Insert and Replace mode through `Ctrl-o`, below. A contenteditable
 * inside an open shadow root and the four rich editors: their own specs.
 * `:wq` and `:x`, which leave the Field blurred behind their notice:
 * `textarea.spec.ts`, `single-line.spec.ts` and `contenteditable.spec.ts`, and
 * `:wq` in each rich editor's spec.
 */
const notices = [
  { line: "/zzz", notice: "No match found" },
  { line: "?zzz", notice: "No match found" },
  { line: ":bogus", notice: "Not an editor command" },
  { line: ":w", notice: "nothing to write" },
  { line: ":s/zzz/y/", notice: "No matches for" },
  { line: ":set nosuchoption", notice: "Unknown option" },
  { line: ":registers", notice: "Registers" },
];

for (const field of fields) {
  for (const { line, notice } of notices) {
    test(`${field.name}: Enter on ${line} shows its notice and leaves the Field focused, the Cursor where it was`, async ({
      page,
    }) => {
      await page.goto(field.url);
      await ready(page);
      await activateAtStart(page, field.selector);
      await page.keyboard.press("w");
      await submitForNotice(page, line, notice);
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
 * A notice from a command line opened in Visual mode (#90): the Field has
 * focus again. The engine leaves Visual when the ex command runs, the Cursor
 * on the selection's last character (its semantics, CODING_STANDARDS rule 3),
 * so `x` deletes the second word's last character.
 */
for (const field of fields) {
  test(`${field.name}: Enter on an unknown ex command from Visual mode leaves the Field focused`, async ({
    page,
  }) => {
    await page.goto(field.url);
    await ready(page);
    await activateAtStart(page, field.selector);
    for (const key of ["w", "v", "e"]) await page.keyboard.press(key);
    await submitForNotice(page, ":bogus", "Not an editor command");
    await expect.poll(() => focused(page, field.selector)).toBe(true);
    await page.keyboard.press("x");
    await expect.poll(() => field.firstLine(page)).toBe(field.afterVeExX);
  });
}

/**
 * From Insert and Replace mode `Ctrl-o` runs one Normal command, the command
 * line included (#90): the Field has focus again and the next character typed
 * goes in at the Cursor. The engine comes back in Insert mode from both: from
 * Replace too, with or without a command line (its semantics,
 * CODING_STANDARDS rule 3), so the typed character is inserted in each.
 */
for (const field of fields) {
  for (const mode of [
    { name: "Insert", key: "i", status: "INSERT" },
    { name: "Replace", key: "R", status: "REPLACE" },
  ]) {
    test(`${field.name}: Enter on an unknown ex command after Ctrl-o in ${mode.name} mode leaves the Field focused`, async ({
      page,
    }) => {
      await page.goto(field.url);
      await ready(page);
      await activateAtStart(page, field.selector);
      await page.keyboard.press("w");
      await page.keyboard.press(mode.key);
      await expect.poll(() => statusText(page)).toContain(mode.status);
      await page.keyboard.press("Control+o");
      await submitForNotice(page, ":bogus", "Not an editor command");
      await expect.poll(() => focused(page, field.selector)).toBe(true);
      await page.keyboard.type("Z");
      await expect.poll(() => field.firstLine(page)).toBe(field.afterWInsert);
    });
  }
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

/**
 * A click outside the command line while it is open closes it and stands
 * (#100): focus stays on what the person clicked, what was typed in the
 * prompt is not run, and the Status Line of the Field they left hides as on
 * any blur. The adapter's own close on blur re-focused the Field, which undid
 * the click, and cleared nothing, which left the prompt's character in the bar.
 *
 * Coverage (CODING_STANDARDS rule 5): Normal mode on a textarea (a click on a
 * text input and on a button), a Single-line Field and a contenteditable (a
 * click on page text, where focus goes to `<body>`), for `:` and `/`, and `?`
 * on the textarea; on the textarea, the `:` command line opened from Visual
 * mode and, through `Ctrl-o`, from Insert and Replace mode. A contenteditable
 * inside an open shadow root: `shadow-contenteditable.spec.ts`. A Field
 * nested in an editable root: `site-shapes.spec.ts`. A Field inside a frame,
 * left by a click in the page around it, is not covered.
 */
const [textarea, singleLine, contentEditable] = fields as [Fixture, Fixture, Fixture];
type Fixture = (typeof fields)[number];

/** The Field's whole text, as the person sees it. */
const wholeText = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el: HTMLElement) => ("value" in el ? (el.value as string) : el.innerText));

/**
 * With the command line just opened on `field`: types into it, clicks
 * `target` and expects the bar hidden, focus on the element with id `focusOn`
 * (`<body>` reads ""), and the Field's text as `before`, also after a key
 * that would change it were it still the Field's.
 */
async function clickAway(page: Page, field: Fixture, target: string, focusOn: string, before: string) {
  await page.keyboard.type("zz");
  await page.locator(target).click();
  // The command line closes a task after its input blurs.
  await expect.poll(() => statusText(page)).toBe("");
  expect(await focusedId(page)).toBe(focusOn);
  await page.keyboard.press("x");
  expect(await focusedId(page)).toBe(focusOn);
  expect(await statusText(page)).toBe("");
  expect(await wholeText(page, field.selector)).toBe(before);
}

const clicksAway = [
  { field: textarea, on: "another text input", target: "#in", focusOn: "in", prompts: [":", "/", "?"] },
  { field: textarea, on: "a button", target: "#btn", focusOn: "btn", prompts: [":", "/"] },
  { field: singleLine, on: "the page's heading", target: "h1", focusOn: "", prompts: [":", "/"] },
  { field: contentEditable, on: "the page's heading", target: "h1", focusOn: "", prompts: [":", "/"] },
];

for (const { field, on, target, focusOn, prompts } of clicksAway) {
  for (const prompt of prompts) {
    test(`${field.name}: a click on ${on} with the ${prompt} command line open keeps focus there and hides the Status Line (#100)`, async ({
      page,
    }) => {
      await page.goto(field.url);
      await ready(page);
      await activateAtStart(page, field.selector);
      const before = await wholeText(page, field.selector);
      await page.keyboard.press("w");
      await page.keyboard.press(prompt);
      await expect.poll(() => statusText(page)).toContain(prompt);
      await clickAway(page, field, target, focusOn, before);
    });
  }
}

for (const from of [
  { mode: "Visual mode", keys: ["v", "e", ":"] },
  { mode: "Insert mode after Ctrl-o", keys: ["i", "Control+o", ":"] },
  { mode: "Replace mode after Ctrl-o", keys: ["R", "Control+o", ":"] },
]) {
  test(`textarea: a click on another text input with the : command line opened from ${from.mode} keeps focus there and hides the Status Line (#100)`, async ({
    page,
  }) => {
    await openActivated(page);
    const before = await wholeText(page, "#ta");
    for (const key of from.keys) await page.keyboard.press(key);
    await expect.poll(() => statusText(page)).toContain(":");
    await clickAway(page, textarea, "#in", "in", before);
    // The key pressed after the click went to the input the person clicked.
    expect(await page.locator("#in").inputValue()).toContain("x");
  });
}

for (const field of [textarea, contentEditable]) {
  for (const prompt of [":", "/"]) {
    test(`${field.name}: a click back into the Field with the ${prompt} command line open leaves it in Normal mode at the clicked place (#100)`, async ({
      page,
    }) => {
      await page.goto(field.url);
      await ready(page);
      await activateAtStart(page, field.selector);
      await page.keyboard.press("w");
      await page.keyboard.press(prompt);
      await expect.poll(() => statusText(page)).toContain(prompt);
      // The start of the Field's first line, where `w` no longer has the Cursor.
      await page.locator(field.selector).click({ position: { x: 3, y: 8 } });
      await expect.poll(() => statusText(page)).toBe("--NORMAL--");
      await page.keyboard.press("x");
      await expect.poll(() => field.firstLine(page)).toBe(field.afterX);
    });
  }

  test(`${field.name}: a click back into the Field after a click away with the command line open shows its Mode again (#100)`, async ({
    page,
  }) => {
    await page.goto(field.url);
    await ready(page);
    await activateAtStart(page, field.selector);
    await page.keyboard.press("w");
    await page.keyboard.press(":");
    await expect.poll(() => statusText(page)).toContain(":");
    await page.locator("h1").click();
    await expect.poll(() => statusText(page)).toBe("");
    await page.locator(field.selector).click({ position: { x: 3, y: 8 } });
    await expect.poll(() => statusText(page)).toBe("--NORMAL--");
    await page.keyboard.press("x");
    await expect.poll(() => field.firstLine(page)).toBe(field.afterX);
  });
}

// A textarea keeps its selection while blurred, so focus given back without a click finds the Cursor.
test("textarea: focus coming back after a click away with the command line open finds the Cursor where it was (#100)", async ({
  page,
}) => {
  await openActivated(page);
  await page.keyboard.press("w");
  await page.keyboard.press(":");
  await expect.poll(() => statusText(page)).toContain(":");
  await page.locator("#in").click();
  await expect.poll(() => statusText(page)).toBe("");
  await page.locator("#ta").focus();
  await expect.poll(() => statusText(page)).toBe("--NORMAL--");
  // `x` deletes the character `w` moved to, the second word's first.
  await page.keyboard.press("x");
  await expect.poll(() => textarea.firstLine(page)).toBe(textarea.afterWX);
});
