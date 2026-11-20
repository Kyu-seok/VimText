import type { Page } from "@playwright/test";
import { decodePng } from "../png";
import { test, expect, ready, activateAtStart, drawnCursor } from "./extension";

/**
 * A Field inside a top-layer element (a modal dialog, an open popover) keeps a
 * Status Line, and on a contenteditable a drawn Cursor, that the user can see
 * (DESIGN.md "Status Line", #77): no z-index paints over the top layer.
 * Checked by hit testing and from the pixels Chromium paints
 * (CODING_STANDARDS rule 14). Coverage: Normal and the command line, on a
 * textarea and a contenteditable.
 */

/** The mean brightness (0–255) Chromium painted in a box of the viewport. */
async function brightness(page: Page, x: number, y: number, width: number, height: number): Promise<number> {
  const png = decodePng(await page.screenshot({ clip: { x, y, width, height } }));
  let sum = 0;
  for (let py = 0; py < png.height; py++)
    for (let px = 0; px < png.width; px++) {
      const [r, g, b] = png.at(px, py);
      sum += (r + g + b) / 3;
    }
  return sum / (png.width * png.height);
}

/** A point 30px in from the Field's left edge, 8px below its bottom edge: inside a Status Line under it. */
function underField(page: Page, selector: string): Promise<{ x: number; y: number }> {
  return page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + 30), y: Math.round(r.bottom + 8) };
  });
}

/** The Status Line under the Field is the topmost element there, and its dark bar is what is painted. */
async function expectStatusLineShown(page: Page, selector: string): Promise<void> {
  const at = await underField(page, selector);
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.localName, at)).toBe(
    "vimtext-status",
  );
  // The bar's background (#1f2430) between its letters, against the white dialog or popover.
  expect(await brightness(page, at.x - 28, at.y - 4, 4, 8)).toBeLessThan(60);
}

for (const layer of ["dialog", "popover"]) {
  test(`a textarea inside an open ${layer} shows its Status Line over the ${layer}`, async ({ page }) => {
    await page.goto(`/top-layer.html?open=${layer}`);
    await ready(page);
    await activateAtStart(page, `#${layer}-ta`);
    await expectStatusLineShown(page, `#${layer}-ta`);
  });

  test(`a contenteditable inside an open ${layer} shows its Status Line and its drawn Cursor over the ${layer}`, async ({
    page,
  }) => {
    await page.goto(`/top-layer.html?open=${layer}`);
    await ready(page);
    await activateAtStart(page, `#${layer}-ce`);
    await expectStatusLineShown(page, `#${layer}-ce`);
    await expect.poll(async () => (await drawnCursor(page))?.shape).toBe("block");
    const block = (await drawnCursor(page))!;
    // Painted, not only placed: the block inverts the white page and the dark glyph.
    expect(await brightness(page, block.left, block.top, block.width, block.height)).toBeLessThan(128);
    await page.keyboard.type("w");
    await expect.poll(async () => (await drawnCursor(page))!.left).toBeGreaterThan(block.left);
  });

  test(`the command line works on a Field inside an open ${layer}, and the ${layer} stays open`, async ({
    page,
  }) => {
    await page.goto(`/top-layer.html?open=${layer}`);
    await ready(page);
    await activateAtStart(page, `#${layer}-ta`);
    await page.keyboard.type(":s/quick/slow/");
    await page.keyboard.press("Enter");
    await expect(page.locator(`#${layer}-ta`)).toHaveValue("the slow brown fox");
    await expectStatusLineShown(page, `#${layer}-ta`);
  });
}

test("the Status Line is raised again when the page opens a popover over it while the Field keeps focus", async ({
  page,
}) => {
  await page.goto("/top-layer.html?open=popover");
  await ready(page);
  await activateAtStart(page, "#popover-ta");
  await page.evaluate(() => document.getElementById("toast")!.showPopover());
  await expect
    .poll(async () => {
      const at = await underField(page, "#popover-ta");
      return page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.localName, at);
    })
    .toBe("vimtext-status");
  await page.keyboard.type("x");
  await expect(page.locator("#popover-ta")).toHaveValue("he quick brown fox");
});

test("a Field outside the top layer keeps its Status Line out of it", async ({ page }) => {
  await page.goto("/top-layer.html");
  await ready(page);
  await activateAtStart(page, "#page-ta");
  await expectStatusLineShown(page, "#page-ta");
  expect(await page.evaluate(() => document.querySelector(":popover-open"))).toBeNull();
  expect(await page.evaluate(() => document.querySelector("vimtext-status")!.parentElement!.localName)).toBe(
    "html",
  );
});
