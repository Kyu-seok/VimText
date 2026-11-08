import { defineConfig } from "@playwright/test";
import { fixturePort as port } from "./tests/e2e/fixture-port";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: `node tools/serve.mjs tests/fixtures ${port}`,
    url: `http://localhost:${port}/textarea.html`,
    reuseExistingServer: true,
  },
});
