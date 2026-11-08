// Bundles the extension into dist/ with esbuild.
// Content script is a classic IIFE (strict page CSPs block dynamic import()).
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

const common = {
  bundle: true,
  format: "iife",
  target: "chrome120",
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  logLevel: "info",
  define: { "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") },
};

const ctx = await esbuild.context({
  ...common,
  entryPoints: {
    content: "src/content.ts",
    background: "src/background.ts",
    "popup/popup": "popup/popup.ts",
    "options/options": "options/options.ts",
  },
  outdir: "dist",
});

// The React e2e fixture: React 19 ships no UMD build, so its source is bundled
// into a gitignored file next to react.html (see tests/fixtures/react.tsx).
async function buildFixtures() {
  await esbuild.build({
    ...common,
    entryPoints: { react: "tests/fixtures/react.tsx" },
    outdir: "tests/fixtures",
  });
}

function copyStatic() {
  cpSync("manifest.json", "dist/manifest.json");
  cpSync("icons", "dist/icons", { recursive: true });
  cpSync("popup/popup.html", "dist/popup/popup.html");
  cpSync("options/options.html", "dist/options/options.html");
}

if (watch) {
  await ctx.watch();
  copyStatic();
  await buildFixtures();
  console.log("watching…");
} else {
  await ctx.rebuild();
  copyStatic();
  await buildFixtures();
  await ctx.dispose();
}
