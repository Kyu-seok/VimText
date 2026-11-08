import { defineConfig } from "@playwright/test";
import { fixturePort as port } from "./tests/e2e/fixture-port";

// Two projects on one launcher (tests/e2e/extension.ts). `npm run test:e2e`
// and the gate run `e2e` alone; `npm run screenshots` runs `screenshots`
// alone, which rewrites the store PNGs under docs/store/ and so stays out of
// the gate (DESIGN.md "Tooling"). A bare `playwright test` runs both.
export default defineConfig({
  timeout: 30_000,
  // One retry tells a flake from a regression: a flake passes the retry and is
  // reported as flaky with a trace under test-results/; a regression fails twice.
  retries: 1,
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://localhost:${port}`, trace: "on-first-retry" },
  webServer: {
    command: `node tools/serve.mjs tests/fixtures ${port}`,
    url: `http://localhost:${port}/textarea.html`,
    reuseExistingServer: true,
  },
  projects: [
    { name: "e2e", testDir: "tests/e2e" },
    {
      name: "screenshots",
      testDir: "tests/screenshots",
      // The Web Store's screenshot size; the launcher reads both options.
      use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    },
  ],
});
