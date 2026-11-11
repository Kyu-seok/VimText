import {
  test,
  expect,
  statusText,
  ready,
  activateAtStart,
  blockTexts,
  hostCount,
  selectedText,
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
  expect(await selectedText(page, "#editor")).toBe("t");
  await page.keyboard.type("ww");
  expect(await selectedText(page, "#editor")).toBe("b"); // into the bold run
  await page.keyboard.type("j$");
  expect(await selectedText(page, "#editor")).toBe("g");
  await page.keyboard.type("G0");
  expect(await selectedText(page, "#editor")).toBe("l");
  await page.keyboard.type("gg");
  expect(await selectedText(page, "#editor")).toBe("t");
});

test("Visual selects inside the shadow tree", async ({ page }) => {
  await activateAtStart(page, "#ce");
  await page.keyboard.type("vee");
  expect(await statusText(page)).toContain("VISUAL");
  expect(await selectedText(page, "#editor")).toBe("the quick");
});

test("x dw cw dd o land as editing commands; u walks them back", async ({ page }) => {
  await activateAtStart(page, "#ce");
  const original = await page.locator("#ce").innerText();
  await page.keyboard.type("x");
  expect((await blockTexts(page, "#ce"))[0]).toBe("he quick brown fox");
  await page.keyboard.type("dw");
  expect((await blockTexts(page, "#ce"))[0]).toBe("quick brown fox");
  await page.keyboard.type("cwslow");
  await page.keyboard.press("Escape");
  expect((await blockTexts(page, "#ce"))[0]).toBe("slow brown fox");
  await expect(page.locator("#ce b")).toHaveText("brown");
  await page.keyboard.type("jdd");
  expect(await blockTexts(page, "#ce")).toEqual(["slow brown fox", "last line"]);
  await page.keyboard.type("onew");
  await page.keyboard.press("Escape");
  expect(await blockTexts(page, "#ce")).toEqual(["slow brown fox", "last line", "new"]);
  const log = ((await page.locator("#log").textContent()) ?? "").split("\n").filter(Boolean);
  for (const line of log) expect(line).toMatch(/^input:(insertText|deleteContentBackward|insertParagraph)$/);
  await page.keyboard.type("uuuuu");
  expect(await page.locator("#ce").innerText()).toBe(original);
  expect(await blockTexts(page, "#ce")).toEqual(ORIGINAL);
});

test("typing in Insert re-projects the host", async ({ page }) => {
  await activateAtStart(page, "#ce");
  await page.keyboard.type("A!!");
  await page.keyboard.press("Escape");
  await page.keyboard.type("x");
  expect((await blockTexts(page, "#ce"))[0]).toBe("the quick brown fox!");
});

test("removing the custom element disposes the Session", async ({ page }) => {
  await activateAtStart(page, "#ce");
  expect(await hostCount(page)).toBe(1);
  await page.evaluate(() => document.getElementById("editor")!.remove());
  await expect.poll(() => hostCount(page)).toBe(0);
});
