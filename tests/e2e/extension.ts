import { test as base, chromium, type BrowserContext, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const dist = resolve("dist");

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
    await use(page);
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

/** The Status Line host VimText injects next to an activated Field. */
export function statusText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const host = document.querySelector("vimtext-status") as HTMLElement | null;
    const bar = host?.shadowRoot?.querySelector(".bar") as HTMLElement | null;
    return bar && host!.style.display !== "none" ? bar.textContent ?? "" : "";
  });
}
