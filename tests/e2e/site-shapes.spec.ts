import { test, expect, statusText, ready, activateAtStart } from "./extension";
import type { Page } from "@playwright/test";

/**
 * The M4 dogfooding steps (docs/release.md, "M4: contenteditable editors") over
 * the real sites' editor markup, copied into tests/fixtures/site-shapes.html:
 * each host is a shape that broke VimText on a live site and no library
 * fixture had. A step fails on a refused edit or on text that did not land.
 *
 * The burst tests press their keys back to back, the way a person typing fast
 * (or an agent's browser tool) does, so the keys land while VimText's write or
 * caret is still settling (ADR 0008). Reading the page between those keys hides
 * what they catch (#68).
 */

const REFUSED = "refused the edit";

test.beforeEach(async ({ page }) => {
  await page.goto("/site-shapes.html");
  await ready(page);
});

/** The host's rendered lines: blank lines and U+FEFF dropped, so innerText's overcounts (docs/engine-seams.md) do not matter. */
function lines(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluate((el: HTMLElement) =>
    el.innerText
      .replace(/﻿/g, "")
      .replace(/ /g, " ")
      .split("\n")
      .filter((l) => l.trim()),
  );
}

/** Presses each key with no wait between them. */
async function burst(page: Page, keys: string[]): Promise<void> {
  for (const k of keys) await page.keyboard.press(k);
}

async function notRefused(page: Page): Promise<void> {
  expect(await statusText(page)).not.toContain(REFUSED);
}

test.describe("Gmail compose body: a bare text first line above <div> lines", () => {
  const ORIGINAL = ["alpha beta gamma", "delta bold run epsilon", "zeta eta theta"];

  test.beforeEach(async ({ page }) => activateAtStart(page, "#gmail"));

  test("o on the first line opens a line and dd takes that line (#67)", async ({ page }) => {
    await page.keyboard.type("ggonew");
    await page.keyboard.press("Escape");
    await expect.poll(() => lines(page, "#gmail")).toEqual(["alpha beta gamma", "new", ...ORIGINAL.slice(1)]);
    await notRefused(page);
    await page.keyboard.type("dd");
    await expect.poll(() => lines(page, "#gmail")).toEqual(ORIGINAL);
    await notRefused(page);
  });

  test("J then u leaves nested <div>s; o there still opens a line (#67)", async ({ page }) => {
    await page.keyboard.type("ggJ");
    await expect
      .poll(() => lines(page, "#gmail"))
      .toEqual(["alpha beta gamma delta bold run epsilon", "zeta eta theta"]);
    await page.keyboard.type("u");
    await expect.poll(() => lines(page, "#gmail")).toEqual(ORIGINAL);
    await page.keyboard.type("jox");
    await page.keyboard.press("Escape");
    await expect.poll(() => lines(page, "#gmail")).toEqual([...ORIGINAL.slice(0, 2), "x", ORIGINAL[2]]);
    await notRefused(page);
  });

  test("cw inside the bold run keeps it bold", async ({ page }) => {
    await page.keyboard.type("ggj0wwcwwalk");
    await page.keyboard.press("Escape");
    await expect.poll(() => page.locator("#gmail b").textContent()).toBe("bold walk");
  });

  test("burst: A, Enter, text and Esc back to back keep the text", async ({ page }) => {
    await burst(page, ["G", "A", "Enter", "o", "n", "e", "Escape"]);
    await expect.poll(() => lines(page, "#gmail")).toEqual([...ORIGINAL, "one"]);
  });
});

test.describe("Slack message box: a line holding only Quill's U+FEFF cursor blot", () => {
  test.beforeEach(async ({ page }) => activateAtStart(page, "#slack"));

  test("G lands on the blot's line and A types there (#68)", async ({ page }) => {
    await page.keyboard.type("GAnew");
    await page.keyboard.press("Escape");
    await expect
      .poll(() => lines(page, "#slack"))
      .toEqual(["alpha beta gamma", "delta bold run epsilon", "zeta eta theta", "new"]);
    await notRefused(page);
  });

  test("burst: k A, Shift+Enter, text and Esc back to back keep the text (#68)", async ({ page }) => {
    await burst(page, ["G", "k", "A", "Shift+Enter", "o", "n", "e", "Escape"]);
    await expect.poll(async () => (await lines(page, "#slack")).join("|")).toContain("one");
    await expect
      .poll(() => lines(page, "#slack").then((l) => l.slice(0, 2)))
      .toEqual(["alpha beta gamma", "delta bold run epsilon"]);
  });
});

test.describe("Notion page: blocks marked contenteditable inside one editable root", () => {
  /** Focus stays on the root, as on Notion; the caret goes into block `#n-two`. */
  test.beforeEach(async ({ page }) => {
    await page.locator("#notion").focus();
    await page
      .locator("#n-two")
      .evaluate((el) => el.ownerDocument.getSelection()!.collapse(el.firstChild, 0));
    await page.keyboard.press("Escape");
    await expect.poll(() => statusText(page)).toContain("NORMAL");
  });

  test("motions and edits stay inside the block with the caret (#69)", async ({ page }) => {
    await page.keyboard.type("kkkJ");
    await expect.poll(() => page.locator("#n-two").innerText()).toBe("line one line two\nline three");
    await page.keyboard.type("Gdd");
    await expect.poll(() => page.locator("#n-two").innerText()).toBe("line one line two");
    expect(await page.locator("#n-one").innerText()).toBe("alpha beta gamma");
    expect(await page.locator("#n-title").innerText()).toBe("Scratch");
    expect(await page.locator("#notion .controls").innerText()).toBe("Add icon Add cover");
  });

  test("burst: A, Enter, text and Esc back to back keep the text, though the line break is refused (#68)", async ({
    page,
  }) => {
    await burst(page, ["G", "A", "Enter", "f", "a", "s", "t", "Escape"]);
    await expect.poll(async () => (await lines(page, "#n-two")).join("|")).toContain("fast");
    expect(await page.locator("#n-one").innerText()).toBe("alpha beta gamma");
  });
});
