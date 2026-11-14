import { test, expect, statusText, ready, activateAtStart, blockTexts, fixtureOrigin } from "./extension";

/**
 * Atoms (#47, DESIGN.md "contenteditable Fields", _Atoms_) through the built
 * extension: a non-editable mention chip and an inline image in a bare
 * contenteditable. To Vim each is one character; in a register, its visible text.
 */

const ORIGINAL = ["hi @alice and  ok", "next line"];

test.beforeEach(async ({ page }) => {
  await page.goto("/atoms.html");
  await ready(page);
  await activateAtStart(page, "#ce");
});

/**
 * Which Atom the collapsed caret stands just before ("chip", "img"): the
 * Cursor on it (ADR 0009). Otherwise the character after the caret.
 */
function cursor(page: import("@playwright/test").Page): Promise<string | null> {
  return page.evaluate(() => {
    const sel = document.getSelection()!;
    if (!sel.isCollapsed) return null;
    const at = sel.getRangeAt(0);
    for (const [name, el] of [
      ["chip", document.querySelector(".mention")],
      ["img", document.querySelector("img")],
    ] as const) {
      if (!el) continue;
      const before = document.createRange();
      before.setStartBefore(el);
      if (at.compareBoundaryPoints(Range.START_TO_START, before) === 0) return name;
    }
    const node = sel.anchorNode;
    return node instanceof Text ? (node.data[sel.anchorOffset] ?? "") : "";
  });
}

test("l h w step over each Atom as one character; the cursor on it is a caret before the Atom", async ({
  page,
}) => {
  await page.keyboard.type("lll");
  await expect.poll(() => cursor(page)).toBe("chip");
  await page.keyboard.type("l");
  await expect.poll(() => cursor(page)).toBe(" ");
  await page.keyboard.type("h");
  await expect.poll(() => cursor(page)).toBe("chip");
  await page.keyboard.type("0w");
  await expect.poll(() => cursor(page)).toBe("chip");
  await page.keyboard.type("ww");
  await expect.poll(() => cursor(page)).toBe("img");
  await page.keyboard.type("w");
  await expect.poll(() => cursor(page)).toBe("o");
});

test("x on an Atom removes the whole element; u brings it back", async ({ page }) => {
  await page.keyboard.type("wx");
  await expect(page.locator("#ce .mention")).toHaveCount(0);
  await page.keyboard.type("u");
  await expect(page.locator("#ce .mention")).toHaveText("@alice");
  await page.keyboard.type("wwx");
  await expect(page.locator("#ce img")).toHaveCount(0);
  await page.keyboard.type("u");
  await expect(page.locator("#ce img")).toHaveAttribute("alt", "cat");
  await expect.poll(() => blockTexts(page, "#ce")).toEqual(ORIGINAL);
});

test("yy then \"0p and :reg show the Atoms' visible text, never U+FFFC", async ({ page }) => {
  await page.keyboard.type('yyj"0p');
  await expect.poll(() => blockTexts(page, "#ce")).toEqual([...ORIGINAL, "hi @alice and cat ok"]);
  await page.keyboard.type(":reg");
  await page.keyboard.press("Enter");
  await expect.poll(() => statusText(page)).toContain("hi @alice and cat ok");
  await expect.poll(() => statusText(page)).not.toContain("\uFFFC");
});

test('"+yy puts the visible text on the system clipboard', async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: fixtureOrigin });
  await page.keyboard.type('"+yy');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("hi @alice and cat ok\n");
});

test("a click inside the chip keeps the host's Session", async ({ page }) => {
  await page.locator("#ce .mention").click();
  await expect.poll(() => statusText(page)).toContain("NORMAL");
  await page.keyboard.type("x");
  await expect(page.locator("#ce .mention")).toHaveCount(0);
});
