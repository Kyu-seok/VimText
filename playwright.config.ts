import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://localhost:4173" },
  webServer: {
    command: "node tools/serve.mjs tests/fixtures 4173",
    url: "http://localhost:4173/textarea.html",
    reuseExistingServer: true,
  },
});
