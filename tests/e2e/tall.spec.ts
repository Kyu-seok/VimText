import { test, expect, ready, statusText, fixtureOrigin } from "./extension";
import type { Frame, Page } from "@playwright/test";

// A Field taller than the viewport keeps a visible Status Line: the strip is
// pinned to the bottom edge of the viewport over the Field's horizontal extent
// while the Field is on screen (DESIGN.md "Status Line"). In a frame the
// viewport is the frame's own. Observed by hit testing, as the user's pointer
// would find it.

/** Scrolls `where`'s window to `y` and waits a frame for the scroll event to land. */
async function scrollTo(where: Page | Frame, y: number): Promise<void> {
  await where.evaluate(async (top) => {
    window.scrollTo(0, top);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, y);
}

/** What sits 8px above the viewport's bottom edge at 5px inside the Field's left and right edges. */
function atViewportBottom(where: Page | Frame): Promise<[string | undefined, string | undefined]> {
  return where.evaluate(() => {
    const r = document.getElementById("ta")!.getBoundingClientRect();
    const y = window.innerHeight - 8;
    return [
      document.elementFromPoint(r.left + 5, y)?.localName,
      document.elementFromPoint(r.right - 5, y)?.localName,
    ];
  });
}

async function checkPinned(page: Page, where: Page | Frame): Promise<void> {
  await where.locator("#ta").focus();
  await page.keyboard.press("Escape");
  expect(await statusText(where)).toContain("NORMAL");

  // The Field spans the viewport: its top above, its bottom below.
  await scrollTo(where, 2000);
  expect(await atViewportBottom(where)).toEqual(["vimtext-status", "vimtext-status"]);

  // Scrolled past the Field: nothing is pinned over the page below it.
  await scrollTo(where, 6000);
  expect(await atViewportBottom(where)).not.toContain("vimtext-status");

  // Back on the Field: the strip is there again.
  await scrollTo(where, 2500);
  expect(await atViewportBottom(where)).toEqual(["vimtext-status", "vimtext-status"]);
}

test("a textarea taller than the viewport keeps its Status Line pinned to the viewport bottom", async ({
  page,
}) => {
  await page.goto("/tall.html");
  await ready(page);
  await checkPinned(page, page);
});

test("a Field taller than its frame's viewport keeps its Status Line pinned to the frame's bottom", async ({
  page,
}) => {
  await page.goto("/frames.html");
  const frame = page.frames().find((f) => f.url().startsWith(`${fixtureOrigin}/tall.html`))!;
  await ready(frame);
  await checkPinned(page, frame);
});
