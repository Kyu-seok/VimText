import { defineConfig } from "@playwright/test";
import e2e from "./playwright.config";

// The store screenshots: `npm run screenshots` runs this config, whose one
// project drives the e2e launcher (tests/e2e/extension.ts) and rewrites the
// PNGs under docs/store/. It takes the e2e config's settings (timeout, retry,
// reporter, fixture server) and replaces its projects, so a bare `playwright
// test`, `npm run test:e2e` and the gate never run it and PNG churn never
// fails `npm run check` (DESIGN.md "Tooling").
export default defineConfig({
  ...e2e,
  projects: [
    {
      name: "screenshots",
      testDir: "tests/screenshots",
      // The Web Store's screenshot size; the launcher reads both options.
      use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    },
  ],
});
