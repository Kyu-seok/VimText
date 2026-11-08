import { defineConfig } from "@playwright/test";
import { fixturePort as port } from "./tests/e2e/fixture-port";

export default defineConfig({
  testDir: "tests/e2e",
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
});
