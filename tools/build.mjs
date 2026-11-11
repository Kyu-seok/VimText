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

// The e2e fixtures bundled from source into gitignored files next to their
// pages: React 19 ships no UMD build (tests/fixtures/react.tsx), and the pinned
// ProseMirror, Quill and Lexical builds are npm modules, the first two with
// their stylesheets (tests/fixtures/prosemirror.ts, quill.ts, lexical.ts).
async function buildFixtures() {
  await esbuild.build({
    ...common,
    entryPoints: {
      react: "tests/fixtures/react.tsx",
      prosemirror: "tests/fixtures/prosemirror.ts",
      quill: "tests/fixtures/quill.ts",
      lexical: "tests/fixtures/lexical.ts",
    },
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
