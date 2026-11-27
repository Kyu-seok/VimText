import { test, expect, chromium } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// The page-world content script (ADR 0010) must add no install warning: Chrome
// disables an updated extension whose warnings grew until the person accepts
// them (#113, Q11 and Q24). Chrome itself is asked, through
// `chrome.management.getPermissionWarningByManifest` on a throwaway extension
// that holds "management": the manifest as it is, against the same manifest
// without the `"world": "MAIN"` entry, which is 0.4.3's.

interface Manifest {
  permissions: string[];
  content_scripts: { world?: string }[];
}

test("the manifest with the page-world content script reports the install warnings 0.4.3's did", async () => {
  const helper = mkdtempSync(join(tmpdir(), "vimtext-warn-ext-"));
  const profile = mkdtempSync(join(tmpdir(), "vimtext-warn-"));
  writeFileSync(
    join(helper, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "warnings",
      version: "1",
      permissions: ["management"],
      background: { service_worker: "sw.js" },
    }),
  );
  writeFileSync(join(helper, "sw.js"), "");
  writeFileSync(join(helper, "page.html"), "<!doctype html><title>warnings</title>");
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${helper}`, `--load-extension=${helper}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
    // The method is not there in the service worker; an extension page has it.
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/page.html`);
    // Chromium 158 names the method in the plural; the documented name is singular.
    const warnings = (manifest: object) =>
      page.evaluate((json) => {
        const management = chrome.management as unknown as Record<
          string,
          ((manifest: string) => Promise<string[]>) | undefined
        >;
        const ask =
          management["getPermissionWarningByManifest"] ?? management["getPermissionWarningsByManifest"]!;
        return ask(json);
      }, JSON.stringify(manifest));

    const now = JSON.parse(readFileSync(resolve("manifest.json"), "utf8")) as Manifest;
    const pageWorld = now.content_scripts.filter((script) => script.world === "MAIN");
    expect(pageWorld).toHaveLength(1);
    const before = { ...now, content_scripts: now.content_scripts.filter((s) => s.world !== "MAIN") };

    const reported = await warnings(now);
    expect(reported).toEqual(await warnings(before));
    // The question can be answered otherwise: with no content script the all-sites
    // warning goes, and one more permission adds one.
    expect((await warnings({ ...now, content_scripts: undefined })).length).toBeLessThan(reported.length);
    expect((await warnings({ ...now, permissions: [...now.permissions, "history"] })).length).toBeGreaterThan(
      reported.length,
    );
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
    rmSync(helper, { recursive: true, force: true });
  }
});
