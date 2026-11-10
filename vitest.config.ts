import { defineConfig } from "vitest/config";

// `npm test` runs two projects. Sync-layer tests run in real Chromium: textarea
// selection and layout are not trustworthy in jsdom. Repo-wide consistency
// checks run in Node: they read files and spawn processes, which a browser
// cannot. CODING_STANDARDS.md ("Mechanical") lists them. Adding a Node check is
// one file: `tests/node/<name>.test.ts`; `tests/node/setup.ts` clears the git
// hook's GIT_* variables before any of them runs.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "chromium",
          include: ["tests/unit/**/*.test.ts"],
          browser: {
            enabled: true,
            provider: "playwright",
            headless: true,
            screenshotFailures: false,
            instances: [{ browser: "chromium" }],
          },
        },
      },
      {
        test: {
          name: "node",
          include: ["tests/node/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/node/setup.ts"],
        },
      },
    ],
  },
});
