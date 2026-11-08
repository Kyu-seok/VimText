import {
  test,
  expect,
  statusText,
  setSettings,
  contentStatus,
  fixtureOrigin,
  extensionId,
} from "./extension";
import type { Frame, Page } from "@playwright/test";

// The content script runs in every frame; a frame belongs to the Site of the
// page around it (DESIGN.md "Frames", ADR 0005). The fixture embeds a
// same-origin frame, a cross-origin one (127.0.0.1 against localhost, same
// server) and a short frame whose Field is flush with its bottom edge.

const crossOrigin = fixtureOrigin.replace("localhost", "127.0.0.1");

function hostCount(where: Page | Frame): Promise<number> {
  return where.evaluate(() => document.querySelectorAll("vimtext-status").length);
}

/** Focuses a Field inside `frame` and Activates it with Esc; the Status Line shows NORMAL in that frame. */
async function activateIn(page: Page, frame: Frame, selector: string): Promise<void> {
  await frame.locator(selector).focus();
  await page.keyboard.press("Escape");
  expect(await statusText(frame)).toContain("NORMAL");
}

/** A loaded child frame of the fixture page, found by the start of its URL. */
async function frameAt(page: Page, prefix: string): Promise<Frame> {
  const frame = page.frames().find((f) => f.url().startsWith(prefix));
  if (!frame)
    throw new Error(
      `no frame at ${prefix}: ${page
        .frames()
        .map((f) => f.url())
        .join(", ")}`,
    );
  return frame;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/frames.html");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300); // content scripts run at document_idle in each frame
});

test("Esc Activates a Field in a same-origin frame; the Status Line lives in that frame", async ({
  context,
  page,
}) => {
  const frame = await frameAt(page, `${fixtureOrigin}/single-line.html`);
  await activateIn(page, frame, "#in");
  expect(await hostCount(frame)).toBe(1);
  expect(await hostCount(page)).toBe(0);
  await page.keyboard.type("0x");
  await expect(frame.locator("#in")).toHaveValue("ello world");
  // The top frame has no Session of its own, and the helper asks it alone.
  expect((await contentStatus(context)).observing).toBe(false);
});

test("Esc Activates a Field in a cross-origin frame; the Status Line lives in that frame", async ({
  page,
}) => {
  const frame = await frameAt(page, `${crossOrigin}/single-line.html`);
  await activateIn(page, frame, "#in");
  expect(await hostCount(frame)).toBe(1);
  expect(await hostCount(page)).toBe(0);
  await page.keyboard.type("0x");
  await expect(frame.locator("#in")).toHaveValue("ello world");
});

test("a Site Policy 'normal' for the Site Activates a Field in the cross-origin frame on focus", async ({
  context,
  page,
}) => {
  await setSettings(context, { enabled: true, sites: { [fixtureOrigin]: "normal" }, vimrc: "", plugins: {} });
  const frame = await frameAt(page, `${crossOrigin}/single-line.html`);
  await frame.locator("#in").focus();
  await expect.poll(() => statusText(frame)).toContain("NORMAL");
  await page.keyboard.type("0x");
  await expect(frame.locator("#in")).toHaveValue("ello world");
});

test("a Site Policy 'off' for the Site leaves Esc to the page inside the cross-origin frame", async ({
  context,
  page,
}) => {
  await setSettings(context, { enabled: true, sites: { [fixtureOrigin]: "off" }, vimrc: "", plugins: {} });
  const frame = await frameAt(page, `${crossOrigin}/single-line.html`);
  await frame.locator("#in").focus();
  await page.keyboard.press("Escape");
  await expect(frame.locator("#log")).toContainText("page-esc");
  expect(await statusText(frame)).toBe("");
});

test("the popup reports the Site and the Mode of a Field focused inside the cross-origin frame", async ({
  context,
  page,
}) => {
  const frame = await frameAt(page, `${crossOrigin}/single-line.html`);
  await activateIn(page, frame, "#in");
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await page.bringToFront();
  await popup.reload();
  await expect(popup.locator("#origin")).toHaveText(fixtureOrigin);
  await expect(popup.locator("#mode")).toHaveText("NORMAL");
});

test("a Field flush with the bottom of a short frame gets its Status Line above it", async ({ page }) => {
  const frame = await frameAt(page, `${fixtureOrigin}/bottom.html`);
  await activateIn(page, frame, "#ta");
  const above = await frame.evaluate(() => {
    const r = document.getElementById("ta")!.getBoundingClientRect();
    return document.elementFromPoint(r.left + 20, r.top - 8)?.localName;
  });
  expect(above).toBe("vimtext-status");
});
