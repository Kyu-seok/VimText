import { defineConfig } from "@playwright/test";

// Parallel worktrees each need their own fixture server (the server serves one tree's fixtures).
const port = process.env.VIMTEXT_E2E_PORT ?? "4173";

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
