import {
  test,
  expect,
  statusText,
  ready,
  activateAtStart,
  blockTexts,
  hostCount,
  cursorChar,
  selectedText,
  submitForNotice,
  noticeLines,
  focusedId,
} from "./extension";

/**
 * A contenteditable inside a web component's open shadow root (#50) through
 * the built extension: the tracer-bullet cases of #44 there, the cursor drawn
 * inside the shadow tree, and disposal when the component leaves the page.
 * Playwright's `#ce` locator pierces the open shadow root.
 */

const ORIGINAL = ["the quick brown fox", "jumps over the lazy dog", "last line"];

test.beforeEach(async ({ page }) => {
  await page.goto("/shadow-contenteditable.html");
  await ready(page);
});

test("Esc Activates on the host in the shadow root; motions move the Normal cursor drawn inside it", async ({
  page,
}) => {
  await activateAtStart(page, "#ce");
  await expect(page.locator("#log")).toBeEmpty();
  await expect.poll(() => cursorChar(page, "#editor")).toBe("t");
  await page.keyboard.type("ww");
  await expect.poll(() => cursorChar(page, "#editor")).toBe("b"); // into the bold run
  await page.keyboard.type("j$");
  await expect.poll(() => cursorChar(page, "#editor")).toBe("g");
  await page.keyboard.type("G0");
  await expect.poll(() => cursorChar(page, "#editor")).toBe("l");
  await page.keyboard.type("gg");
  await expect.poll(() => cursorChar(page, "#editor")).toBe("t");
});

test("Visual selects inside the shadow tree", async ({ page }) => {
  await activateAtStart(page, "#ce");
  await page.keyboard.type("vee");
  await expect.poll(() => statusText(page)).toContain("VISUAL");
  await expect.poll(() => selectedText(page, "#editor")).toBe("the quick");
});

test("x dw cw dd o land as editing commands; u walks them back", async ({ page }) => {
  await activateAtStart(page, "#ce");
  const original = await page.locator("#ce").innerText();
  await page.keyboard.type("x");
  await expect.poll(async () => (await blockTexts(page, "#ce"))[0]).toBe("he quick brown fox");
  await page.keyboard.type("dw");
  await expect.poll(async () => (await blockTexts(page, "#ce"))[0]).toBe("quick brown fox");
  await page.keyboard.type("cwslow");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await blockTexts(page, "#ce"))[0]).toBe("slow brown fox");
  await expect(page.locator("#ce b")).toHaveText("brown");
  await page.keyboard.type("jdd");
  await expect.poll(() => blockTexts(page, "#ce")).toEqual(["slow brown fox", "last line"]);
  await page.keyboard.type("onew");
  await page.keyboard.press("Escape");
  await expect.poll(() => blockTexts(page, "#ce")).toEqual(["slow brown fox", "last line", "new"]);
  const log = ((await page.locator("#log").textContent()) ?? "").split("\n").filter(Boolean);
  for (const line of log) expect(line).toMatch(/^input:(insertText|deleteContentBackward|insertParagraph)$/);
  await page.keyboard.type("uuuuu");
  await expect.poll(() => page.locator("#ce").innerText()).toBe(original);
  await expect.poll(() => blockTexts(page, "#ce")).toEqual(ORIGINAL);
});

test("typing in Insert re-projects the host", async ({ page }) => {
  await activateAtStart(page, "#ce");
  await page.keyboard.type("A!!");
  await page.keyboard.press("Escape");
  await page.keyboard.type("x");
  await expect.poll(async () => (await blockTexts(page, "#ce"))[0]).toBe("the quick brown fox!");
});

test("removing the custom element disposes the Session", async ({ page }) => {
  await activateAtStart(page, "#ce");
  expect(await hostCount(page)).toBe(1);
  await page.evaluate(() => document.getElementById("editor")!.remove());
  await expect.poll(() => hostCount(page)).toBe(0);
});

test(":q leaves the host with nothing highlighted inside the shadow tree; refocus resumes on the same character (#65)", async ({
  page,
}) => {
  const ce = page.locator("#ce");
  await activateAtStart(page, "#ce");
  await page.keyboard.type("l");
  await expect.poll(() => cursorChar(page, "#editor")).toBe("h");
  await page.keyboard.type(":q");
  await page.keyboard.press("Enter");
  await expect(ce).not.toBeFocused();
  await expect.poll(() => selectedText(page, "#editor")).toBe("");
  expect(await statusText(page)).toBe("");
  await ce.focus();
  await expect.poll(() => statusText(page)).toContain("NORMAL");
  await page.keyboard.type("x");
  await expect.poll(async () => (await blockTexts(page, "#ce"))[0]).toBe("te quick brown fox");
});

test("Esc in the command line leaves the Cursor where it was inside the shadow tree (#88)", async ({
  page,
}) => {
  await activateAtStart(page, "#ce");
  await page.keyboard.press("w");
  await page.keyboard.press(":");
  await expect.poll(() => statusText(page)).toContain(":");
  await page.keyboard.press("Escape");
  await expect.poll(() => statusText(page)).toContain("NORMAL");
  await expect.poll(() => cursorChar(page, "#editor")).toBe("q");
  await page.keyboard.press("x");
  await expect.poll(async () => (await blockTexts(page, "#ce"))[0]).toBe("the uick brown fox");
});

test("a click on the page's heading with the command line open keeps focus off the host and hides the Status Line (#100)", async ({
  page,
}) => {
  await activateAtStart(page, "#ce");
  await page.keyboard.press("w");
  await page.keyboard.press(":");
  await expect.poll(() => statusText(page)).toContain(":");
  await page.locator("h1").click();
  // The command line closes a task after its input blurs.
  await expect.poll(() => statusText(page)).toBe("");
  expect(await focusedId(page)).toBe("");
  await page.keyboard.press("x");
  expect(await statusText(page)).toBe("");
  expect(await blockTexts(page, "#ce")).toEqual(ORIGINAL);
  // Back by a click at the start of the first line: Normal mode, at the clicked place.
  await page.locator("#ce").click({ position: { x: 3, y: 8 } });
  await expect.poll(() => statusText(page)).toBe("--NORMAL--");
  await page.keyboard.press("x");
  await expect.poll(async () => (await blockTexts(page, "#ce"))[0]).toBe("he quick brown fox");
});

// A command line whose Enter ends in a notice leaves the Cursor drawn on its character (#90).
for (const { line, notice } of noticeLines) {
  test(`Enter on ${line} shows its notice and leaves the Cursor where it was inside the shadow tree (#90)`, async ({
    page,
  }) => {
    await activateAtStart(page, "#ce");
    await page.keyboard.press("w");
    await submitForNotice(page, line, notice);
    await expect.poll(() => cursorChar(page, "#editor")).toBe("q");
    await page.keyboard.press("x");
    await expect.poll(async () => (await blockTexts(page, "#ce"))[0]).toBe("the uick brown fox");
  });
}
