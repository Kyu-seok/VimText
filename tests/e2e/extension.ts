import { test as base, chromium, type BrowserContext, type Frame, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const dist = resolve("dist");

import { fixtureOrigin } from "./fixture-port";

export { fixtureOrigin };

/** Launches Chromium with the built extension loaded (needs `npm run build` first). */
export const test = base.extend<{ context: BrowserContext; page: Page }>({
  context: async ({}, use) => {
    const userDataDir = mkdtempSync(resolve(tmpdir(), "vimtext-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    });
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error" && /VimText/.test(m.text())) errors.push(`console: ${m.text()}`);
    });
    await use(page);
    // An engine exception shows up as a wrong value otherwise; fail loudly instead.
    base.expect(errors, "VimText errors during the test").toEqual([]);
  },
});

export const expect = base.expect;

/** Chrome derives an unpacked extension's id from the SHA-256 of its absolute path. */
export const extensionId = createHash("sha256")
  .update(dist)
  .digest("hex")
  .slice(0, 32)
  .replace(/[0-9a-f]/g, (c) => String.fromCharCode("a".charCodeAt(0) + parseInt(c, 16)));

/** Writes settings via the options page (the only context with chrome.storage). */
export async function setSettings(context: BrowserContext, settings: object): Promise<void> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options/options.html`);
  await page.evaluate((s) => chrome.storage.sync.set({ settings: s }), settings);
  await page.close();
}

/**
 * Resolves once the content script has run in `where` (a page or a frame): it
 * marks its document on load, so no spec guesses how long `document_idle` takes.
 */
export async function ready(where: Page | Frame): Promise<void> {
  await where.waitForSelector("html[data-vimtext]", { state: "attached" });
}

/** The Status Line host VimText injects next to an activated Field, in that page or frame. */
export function statusText(page: Page | Frame): Promise<string> {
  return page.evaluate(() => {
    const host = document.querySelector("vimtext-status") as HTMLElement | null;
    const bar = host?.shadowRoot?.querySelector(".bar") as HTMLElement | null;
    return bar && host!.style.display !== "none" ? (bar.textContent ?? "") : "";
  });
}

/** Toggles a Plugin in the options page; it applies at the next Activation, the rule the vimrc follows. */
export async function setPlugin(page: Page, plugin: "surround" | "targets", on: boolean): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/options/options.html`);
  const toggle = page.locator(`#plugin-${plugin}`);
  await toggle.setChecked(on);
  await base.expect(toggle).toBeChecked({ checked: on });
}

/** Opens the textarea fixture with VimText Activated on `#ta`, the caret at its start. */
export async function openActivated(page: Page): Promise<void> {
  await page.goto("/textarea.html");
  await ready(page);
  await activateAtStart(page, "#ta");
}

/** Focuses a Field, parks the caret at its start and Activates VimText with Esc. */
export async function activateAtStart(page: Page, selector = "#in"): Promise<void> {
  const field = page.locator(selector);
  await field.focus();
  await field.evaluate((el: HTMLInputElement | HTMLTextAreaElement) => el.setSelectionRange(0, 0));
  await page.keyboard.press("Escape");
  base.expect(await statusText(page)).toContain("NORMAL");
}

/** What the content script of a tab's top frame reports (the popup's `vimtext:status` query). */
export interface ContentStatus {
  /** The Site origin: the top page's. */
  origin: string;
  /** True while the top frame's lifecycle MutationObserver is connected (only while a Session exists). */
  observing: boolean;
}

/**
 * Asks the content script of the fixture tab's top frame for its status,
 * through an extension page (the only context with `chrome.tabs`). Pinned to
 * frame 0: without it every frame answers and the first one wins. Tabs without
 * the content script (extension pages themselves) do not answer and are skipped.
 */
export async function contentStatus(context: BrowserContext): Promise<ContentStatus> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options/options.html`);
  const statuses = await page.evaluate(async (origin) => {
    const tabs = await chrome.tabs.query({});
    const answers: ContentStatus[] = [];
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        const res = (await chrome.tabs.sendMessage(
          tab.id,
          { type: "vimtext:status" },
          { frameId: 0 },
        )) as ContentStatus;
        if (res?.origin === origin) answers.push(res);
      } catch {
        // no content script in this tab
      }
    }
    return answers;
  }, fixtureOrigin);
  await page.close();
  if (statuses.length !== 1) throw new Error(`expected one fixture tab, got ${statuses.length}`);
  return statuses[0]!;
}
