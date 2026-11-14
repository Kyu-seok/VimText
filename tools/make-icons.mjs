// Renders the extension's icons (manifest `icons` and `action.default_icon`) into icons/:
// `npm run icons`, or `node tools/make-icons.mjs --out <dir>` to write elsewhere (the Node
// test, tests/node/icons.test.ts, renders twice into temp folders and compares the bytes).
//
// - icon128.png: the store icon, docs/store/icon.svg, as it is (96px artwork in 16px of
//   transparent padding, Chrome's guidance for manifest icons too).
// - icon48.png: the same drawing scaled down, without the `-- NORMAL --` mode-line text,
//   which is 3px tall at that size; the band behind it stays.
// - icon16.png: tools/icon16.svg, the tile, outline and block cursor without text, drawn on
//   the pixel grid and filling the canvas.
//
// The SVGs set their text in Menlo, so they are rasterised in the Playwright Chromium the
// e2e tests use, and the committed PNGs come from a macOS run (docs/store/icon.svg's comment).
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const outDir = outFlag === -1 ? resolve(root, "icons") : resolve(args[outFlag + 1] ?? "");

const storeIcon = resolve(root, "docs/store/icon.svg");
const icons = [
  { size: 128, source: storeIcon, dropText: [] },
  { size: 48, source: storeIcon, dropText: ["-- NORMAL --"] },
  { size: 16, source: resolve(root, "tools/icon16.svg"), dropText: [] },
];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  for (const { size, source, dropText } of icons) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(source).href);
    // Scale the drawing to the canvas: its viewBox stays, its width and height become the size.
    await page.evaluate(
      ({ size, dropText }) => {
        const svg = document.documentElement;
        svg.setAttribute("width", String(size));
        svg.setAttribute("height", String(size));
        for (const text of dropText) {
          const element = [...svg.querySelectorAll("text")].find((t) => t.textContent?.trim() === text);
          if (!element) throw new Error(`no <text> reading "${text}" to drop`);
          element.remove();
        }
      },
      { size, dropText },
    );
    const file = resolve(outDir, `icon${size}.png`);
    await page.screenshot({
      path: file,
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    await page.close();
    console.log(`wrote ${file}`);
  }
} finally {
  await browser.close();
}
