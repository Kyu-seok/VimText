import {
  test as base,
  expect,
  statusText,
  ready,
  activateAtStart,
  blockTexts,
  selectedText,
  fixtureOrigin,
} from "./extension";
import type { ContentEditableOption } from "./contenteditable-option";

/**
 * The host's `contenteditable` value: `true` in the `e2e` project, and the
 * `e2e plaintext-only` project (playwright.config.ts) reruns this file on a
 * `plaintext-only` host (#45).
 */
const test = base.extend<ContentEditableOption>({ contenteditable: ["true", { option: true }] });

/**
 * Vim on a bare contenteditable of plain blocks (#44, ADR 0007) through the
 * built extension: real keys, the page's own events, the host's markup.
 * `blockTexts` is each direct child block's `textContent`, so the third block
 * (`third line<br>fourth line`) reads joined there while it is two lines to Vim.
 */

const ORIGINAL = ["the quick brown fox", "jumps over the lazy dog", "third linefourth line", "", "last line"];

test.beforeEach(async ({ page, contenteditable }) => {
  await page.goto(`/contenteditable.html?contenteditable=${contenteditable}`);
  expect(await page.locator("#ce").getAttribute("contenteditable")).toBe(contenteditable);
  await ready(page);
});

async function pageLog(page: import("@playwright/test").Page): Promise<string[]> {
  const text = (await page.locator("#log").textContent()) ?? "";
  return text.split("\n").filter(Boolean);
}

test("is inert until Esc, then Activates on the host with NORMAL", async ({ page }) => {
  const ce = page.locator("#ce");
  await ce.focus();
  await expect.poll(() => statusText(page)).toBe("");
  await page.keyboard.press("Escape");
  await expect.poll(() => statusText(page)).toContain("NORMAL");
  await expect(page.locator("#log")).not.toContainText("page-esc");
  await expect.poll(() => blockTexts(page, "#ce")).toEqual(ORIGINAL);
});

test("j k w $ gg G move across blocks and <br> lines; the cursor is the native selection", async ({
  page,
}) => {
  await activateAtStart(page, "#ce");
  await expect.poll(() => selectedText(page)).toBe("t");
  await page.keyboard.type("ww");
  await expect.poll(() => selectedText(page)).toBe("b"); // into the bold run
  await page.keyboard.type("j");
  await expect.poll(() => selectedText(page)).toBe(" "); // "jumps over the", column 10
  await page.keyboard.type("j$");
  await expect.poll(() => selectedText(page)).toBe("e"); // "third line", before the <br>
  await page.keyboard.type("j0");
  await expect.poll(() => selectedText(page)).toBe("f"); // "fourth line", after the <br>
  await page.keyboard.type("G");
  await expect.poll(() => selectedText(page)).toBe("l");
  await page.keyboard.type("k");
  // The empty block: a collapsed caret inside it.
  await expect.poll(() => selectedText(page)).toBe("");
  expect(
    await page.evaluate(() => {
      const sel = document.getSelection()!;
      return sel.isCollapsed && document.querySelector("#ce")!.children[3]!.contains(sel.anchorNode);
    }),
  ).toBe(true);
  await page.keyboard.type("gg");
  await expect.poll(() => selectedText(page)).toBe("t");
});

test("x dw cw dd J edit through editing commands: the page sees only editing input events", async ({
  page,
}) => {
  await activateAtStart(page, "#ce");
  await page.evaluate(() => (document.getElementById("log")!.textContent = ""));
  await page.keyboard.type("x");
  await expect.poll(async () => (await blockTexts(page, "#ce"))[0]).toBe("he quick brown fox");
  await page.keyboard.type("dw");
  await expect.poll(async () => (await blockTexts(page, "#ce"))[0]).toBe("quick brown fox");
  await page.keyboard.type("cwslow");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await blockTexts(page, "#ce"))[0]).toBe("slow brown fox");
  await expect(page.locator("#ce b")).toHaveText("brown"); // the bold run survives
  // A middle line between two <p>s (a merge into the <div> moves its first line into the <p> instead).
  await page.keyboard.type("Gkdd");
  await expect
    .poll(() => blockTexts(page, "#ce"))
    .toEqual(["slow brown fox", "jumps over the lazy dog", "third linefourth line", "last line"]);
  await page.keyboard.type("ggJ");
  await expect
    .poll(() => blockTexts(page, "#ce"))
    .toEqual(["slow brown fox jumps over the lazy dog", "third linefourth line", "last line"]);
  const log = (await pageLog(page)).filter((l) => !l.startsWith("page-"));
  // Each write step is a synthetic beforeinput, then (nothing cancels it here) the command's input (ADR 0008); the typed "slow" is the editor's own (insertText too).
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
  await expect
    .poll(() => blockTexts(page, "#ce"))
    .toEqual(["top", "the quick brown fox", "new", ...ORIGINAL.slice(1)]);
  await page.keyboard.type("yyGp");
  await expect
    .poll(() => blockTexts(page, "#ce"))
    .toEqual(["top", "the quick brown fox", "new", ...ORIGINAL.slice(1), "top"]);
  await page.keyboard.type("ggjdd");
  await expect.poll(() => blockTexts(page, "#ce")).toEqual(["top", "new", ...ORIGINAL.slice(1), "top"]);
  await page.keyboard.type("ggJ");
  await expect.poll(() => blockTexts(page, "#ce")).toEqual(["top new", ...ORIGINAL.slice(1), "top"]);
});

/**
 * The whole text as Vim sees it, through a `"+` yank of every line: an undo
 * restores the text, not always the markup (a merge into the <div> moves its
 * first line into the <p>; on a plaintext-only host a `<br>` is left ending a
 * block), and `innerText` reads such markup with other blank-line counts.
 */
async function vimText(page: import("@playwright/test").Page): Promise<string> {
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page.keyboard.type('gg"+yG');
  let text = "";
  await expect
    .poll(async () => (text = await page.evaluate(() => navigator.clipboard.readText())))
    .not.toBe("");
  return text;
}

test("u and Ctrl-r walk VimText's history and restore the text exactly", async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: fixtureOrigin });
  await activateAtStart(page, "#ce");
  const original = await vimText(page);
  expect(original).toBe(
    "the quick brown fox\njumps over the lazy dog\nthird line\nfourth line\n\nlast line\n",
  );
  await page.keyboard.type("x");
  await page.keyboard.type("dd");
  await page.keyboard.type("onew");
  await page.keyboard.press("Escape");
  const edited = await vimText(page);
  expect(edited).toBe("jumps over the lazy dog\nnew\nthird line\nfourth line\n\nlast line\n");
  await page.keyboard.type("uuu");
  expect(await vimText(page)).toBe(original);
  for (let i = 0; i < 3; i++) await page.keyboard.press("Control+r");
  expect(await vimText(page)).toBe(edited);
});

test("typing in Insert re-projects; an outside DOM change is picked up on the next key", async ({ page }) => {
  await activateAtStart(page, "#ce");
  await page.keyboard.type("A!!");
  await page.keyboard.press("Escape");
  await page.keyboard.type("x");
  await expect.poll(async () => (await blockTexts(page, "#ce"))[0]).toBe("the quick brown fox!");
  // The cursor lands once the `x` write has settled (ADR 0008): a page change
  // during a write is judged with it, and wins over keys pressed meanwhile.
  await expect.poll(() => selectedText(page)).toBe("!");
  await page.evaluate(
    () => (document.querySelector("#ce")!.children[1]!.textContent = "changed by the page"),
  );
  await page.keyboard.type("j0dw");
  await expect.poll(async () => (await blockTexts(page, "#ce"))[1]).toBe("by the page");
});

test("Enter in Normal is the Vim motion; Cmd/Ctrl+Enter reach the page", async ({ page }) => {
  await activateAtStart(page, "#ce");
  await page.keyboard.press("Enter");
  await expect.poll(() => selectedText(page)).toBe("j");
  await expect.poll(() => blockTexts(page, "#ce")).toEqual(ORIGINAL);
  await expect(page.locator("#log")).not.toContainText("page-enter");
  await page.keyboard.press("Meta+Enter");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator("#log")).toContainText("page-enter:meta");
  await expect(page.locator("#log")).toContainText("page-enter:ctrl");
});
