import { defineConfig } from "@playwright/test";
import { fixturePort as port } from "./tests/e2e/fixture-port";
import type { ContentEditableOption } from "./tests/e2e/contenteditable-option";

// The e2e project on the extension launcher (tests/e2e/extension.ts): what
// `npm run test:e2e`, the gate and a bare `playwright test` run. The store
// screenshots are a second project in playwright.screenshots.config.ts, which
// extends this config (`npm run screenshots`) and so stays out of the gate
// (DESIGN.md "Tooling").
export default defineConfig<ContentEditableOption>({
  timeout: 30_000,
  // One retry tells a flake from a regression: a flake passes the retry and is
  // reported as flaky with a trace under test-results/; a regression fails twice.
  // A flake still fails the run: it is a bug in the test or the extension
  // (#46 found Activation racing the settings load behind three flakes the
  // retry had absorbed), so the gate stays red until it is diagnosed.
  retries: 1,
  failOnFlakyTests: true,
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
    // The contenteditable tracer-bullet cases again on a `plaintext-only` host (#45).
    {
      name: "e2e plaintext-only",
      testDir: "tests/e2e",
      testMatch: "contenteditable.spec.ts",
      use: { contenteditable: "plaintext-only" },
    },
  ],
});
