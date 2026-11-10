import { test, expect, statusText, ready, activateAtStart, blockTexts, selectedText } from "./extension";

/**
 * Vim on a bare contenteditable of plain blocks (#44, ADR 0007) through the
 * built extension: real keys, the page's own events, the host's markup.
 * `blockTexts` is each direct child block's `textContent`, so the third block
 * (`third line<br>fourth line`) reads joined there while it is two lines to Vim.
 */

const ORIGINAL = ["the quick brown fox", "jumps over the lazy dog", "third linefourth line", "", "last line"];

test.beforeEach(async ({ page }) => {
  await page.goto("/contenteditable.html");
  await ready(page);
});

async function pageLog(page: import("@playwright/test").Page): Promise<string[]> {
  const text = (await page.locator("#log").textContent()) ?? "";
  return text.split("\n").filter(Boolean);
}

test("is inert until Esc, then Activates on the host with NORMAL", async ({ page }) => {
  const ce = page.locator("#ce");
  await ce.focus();
  expect(await statusText(page)).toBe("");
  await page.keyboard.press("Escape");
  expect(await statusText(page)).toContain("NORMAL");
  await expect(page.locator("#log")).not.toContainText("page-esc");
  expect(await blockTexts(page, "#ce")).toEqual(ORIGINAL);
});

test("j k w $ gg G move across blocks and <br> lines; the cursor is the native selection", async ({
  page,
}) => {
  await activateAtStart(page, "#ce");
  expect(await selectedText(page)).toBe("t");
  await page.keyboard.type("ww");
  expect(await selectedText(page)).toBe("b"); // into the bold run
  await page.keyboard.type("j");
  expect(await selectedText(page)).toBe(" "); // "jumps over the", column 10
  await page.keyboard.type("j$");
  expect(await selectedText(page)).toBe("e"); // "third line", before the <br>
  await page.keyboard.type("j0");
  expect(await selectedText(page)).toBe("f"); // "fourth line", after the <br>
  await page.keyboard.type("G");
  expect(await selectedText(page)).toBe("l");
  await page.keyboard.type("k");
  // The empty block: a collapsed caret inside it.
  expect(await selectedText(page)).toBe("");
  expect(
    await page.evaluate(() => {
      const sel = document.getSelection()!;
      return sel.isCollapsed && document.querySelector("#ce")!.children[3]!.contains(sel.anchorNode);
    }),
  ).toBe(true);
  await page.keyboard.type("gg");
  expect(await selectedText(page)).toBe("t");
});

test("x dw cw dd J edit through editing commands: the page sees only editing input events", async ({
  page,
}) => {
  await activateAtStart(page, "#ce");
  await page.evaluate(() => (document.getElementById("log")!.textContent = ""));
  await page.keyboard.type("x");
  expect((await blockTexts(page, "#ce"))[0]).toBe("he quick brown fox");
  await page.keyboard.type("dw");
  expect((await blockTexts(page, "#ce"))[0]).toBe("quick brown fox");
  await page.keyboard.type("cwslow");
  await page.keyboard.press("Escape");
  expect((await blockTexts(page, "#ce"))[0]).toBe("slow brown fox");
  await expect(page.locator("#ce b")).toHaveText("brown"); // the bold run survives
  // A middle line between two <p>s (a merge into the <div> moves its first line into the <p> instead).
  await page.keyboard.type("Gkdd");
  expect(await blockTexts(page, "#ce")).toEqual([
    "slow brown fox",
    "jumps over the lazy dog",
    "third linefourth line",
    "last line",
  ]);
  await page.keyboard.type("ggJ");
  expect(await blockTexts(page, "#ce")).toEqual([
    "slow brown fox jumps over the lazy dog",
    "third linefourth line",
    "last line",
  ]);
  const log = (await pageLog(page)).filter((l) => !l.startsWith("page-"));
  // Chrome fires no beforeinput for execCommand; the typed "slow" is the editor's own (insertText too).
  expect(log.filter((l) => l.startsWith("input:")).length).toBeGreaterThan(0);
  for (const line of log) {
    expect(line).toMatch(
      /^(input|beforeinput):(insertText|deleteContentBackward|deleteContentForward|insertParagraph)$/,
    );
  }
});

test("o O and a linewise p make new blocks; dd and J merge them", async ({ page }) => {
  await activateAtStart(page, "#ce");
  await page.keyboard.type("onew");
  await page.keyboard.press("Escape");
  await page.keyboard.type("ggOtop");
  await page.keyboard.press("Escape");
  expect(await blockTexts(page, "#ce")).toEqual(["top", "the quick brown fox", "new", ...ORIGINAL.slice(1)]);
  await page.keyboard.type("yyGp");
  expect(await blockTexts(page, "#ce")).toEqual([
    "top",
    "the quick brown fox",
    "new",
    ...ORIGINAL.slice(1),
    "top",
  ]);
  await page.keyboard.type("ggjdd");
  expect(await blockTexts(page, "#ce")).toEqual(["top", "new", ...ORIGINAL.slice(1), "top"]);
  await page.keyboard.type("ggJ");
  expect(await blockTexts(page, "#ce")).toEqual(["top new", ...ORIGINAL.slice(1), "top"]);
});

// The edits stay among the <p> blocks: a merge into the <div> moves its first
// line into the <p> (same text, other markup), which Chrome's innerText reads
// with a different count of blank lines.
test("u and Ctrl-r walk VimText's history and restore the text exactly", async ({ page }) => {
  await activateAtStart(page, "#ce");
  const original = await page.locator("#ce").innerText();
  await page.keyboard.type("x");
  await page.keyboard.type("dd");
  await page.keyboard.type("onew");
  await page.keyboard.press("Escape");
  const edited = await page.locator("#ce").innerText();
  await page.keyboard.type("uuu");
  expect(await page.locator("#ce").innerText()).toBe(original);
  for (let i = 0; i < 3; i++) await page.keyboard.press("Control+r");
  expect(await page.locator("#ce").innerText()).toBe(edited);
});

test("typing in Insert re-projects; an outside DOM change is picked up on the next key", async ({ page }) => {
  await activateAtStart(page, "#ce");
  await page.keyboard.type("A!!");
  await page.keyboard.press("Escape");
  await page.keyboard.type("x");
  expect((await blockTexts(page, "#ce"))[0]).toBe("the quick brown fox!");
  await page.evaluate(
    () => (document.querySelector("#ce")!.children[1]!.textContent = "changed by the page"),
  );
  await page.keyboard.type("j0dw");
  expect((await blockTexts(page, "#ce"))[1]).toBe("by the page");
});

test("Enter in Normal is the Vim motion; Cmd/Ctrl+Enter reach the page", async ({ page }) => {
  await activateAtStart(page, "#ce");
  await page.keyboard.press("Enter");
  expect(await selectedText(page)).toBe("j");
  expect(await blockTexts(page, "#ce")).toEqual(ORIGINAL);
  await expect(page.locator("#log")).not.toContainText("page-enter");
  await page.keyboard.press("Meta+Enter");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator("#log")).toContainText("page-enter:meta");
  await expect(page.locator("#log")).toContainText("page-enter:ctrl");
});
