import type { Page } from "@playwright/test";
import { test, expect, ready, statusText } from "./extension";
import { setMonacoSetting } from "./monaco";

// VimText's page-world script runs in every page's own world (ADR 0010). On a
// page it has no business with it must be inert: the one listener it adds is
// for VimText's own request event, and it reads nothing of the page, not even
// whether `window.monaco` exists, until the content script asks. Observed from
// the page's side, on a page with no script of its own: the listeners added in
// the page's world by a script of the extension (Playwright adds its own
// there), and every read of `window.monaco`.

interface Probe {
  listeners: string[];
  monacoReads: number;
}

/** A page with no script, a textarea, and Monaco's input markup with no Monaco behind it. */
async function openProbedPage(page: Page): Promise<void> {
  // Before any script of the document, VimText's page-world script included.
  await page.addInitScript(() => {
    const probe: Probe = { listeners: [], monacoReads: 0 };
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (this: EventTarget, ...args) {
      if (new Error().stack?.includes("chrome-extension://")) probe.listeners.push(args[0]);
      return add.apply(this, args);
    };
    Object.defineProperty(window, "monaco", {
      configurable: true,
      get() {
        probe.monacoReads++;
        return undefined;
      },
    });
    Object.assign(window, { probe });
  });
  await page.route("**/no-script.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><textarea id="ta">hello</textarea><div class="monaco-editor"><textarea class="inputarea"></textarea></div>',
    }),
  );
  await page.goto("/no-script.html");
  await ready(page);
}

const probe = (page: Page) => page.evaluate(() => (window as unknown as { probe: Probe }).probe);

for (const setting of [false, true]) {
  test(`setting ${setting ? "on" : "off"}: with VimText used on a textarea, the page-world script has added its one listener and read nothing`, async ({
    page,
    context,
  }) => {
    await setMonacoSetting(context, setting);
    await openProbedPage(page);
    await page.locator("#ta").focus();
    await page.keyboard.press("Escape");
    await expect.poll(() => statusText(page)).toContain("NORMAL");
    await page.keyboard.type("x");
    await expect(page.locator("#ta")).toHaveValue("ello");
    expect(await probe(page)).toEqual({ listeners: ["vimtext:monaco:request"], monacoReads: 0 });
  });
}

test("setting off: focus and keys on Monaco's input ask the page world nothing", async ({
  page,
  context,
}) => {
  await setMonacoSetting(context, false);
  await openProbedPage(page);
  await page.locator(".inputarea").focus();
  await page.keyboard.press("Escape");
  await page.keyboard.type("x");
  await expect(page.locator(".inputarea")).toHaveValue("x");
  expect(await probe(page)).toEqual({ listeners: ["vimtext:monaco:request"], monacoReads: 0 });
});

test("setting on: focus on Monaco's input is the ask, and only then is window.monaco read", async ({
  page,
  context,
}) => {
  await setMonacoSetting(context, true);
  await openProbedPage(page);
  expect((await probe(page)).monacoReads).toBe(0);
  await page.locator(".inputarea").focus();
  await page.keyboard.press("Escape");
  const after = await probe(page);
  expect(after.monacoReads).toBeGreaterThan(0);
  expect(after.listeners).toEqual(["vimtext:monaco:request"]);
  // No Monaco behind the markup: not a Field.
  expect(await statusText(page)).toBe("");
});
