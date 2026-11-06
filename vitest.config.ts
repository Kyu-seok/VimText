import { defineConfig } from "vitest/config";

// Sync-layer tests run in real Chromium: textarea selection and layout are
// not trustworthy in jsdom.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    browser: {
      enabled: true,
      provider: "playwright",
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
