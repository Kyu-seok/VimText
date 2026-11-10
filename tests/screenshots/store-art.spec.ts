import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test, expect } from "@playwright/test";

// The store icon and the two promo tiles, rendered by `npm run screenshots`
// from their sources in docs/store/ (`icon.svg`, `promo/small.html`,
// `promo/marquee.html`) at the Web Store's sizes. The icon keeps its
// transparent padding; the tiles are opaque. The text uses Menlo and the
// system sans-serif, so render on macOS for the committed look. The pre-commit
// hook runs prettier over the HTML, which reflows text, so lay lines out with
// elements, never with `white-space: pre` (it flattened the marquee's comment
// once). The gate's own check of the committed files is
// tests/node/store-art.test.ts.

const storeDir = resolve("docs/store");

function pngSize(file: string): { width: number; height: number } {
  const png = readFileSync(file);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

const art = [
  { source: "icon.svg", out: "icon-128.png", width: 128, height: 128, transparent: true },
  { source: "promo/small.html", out: "promo-small.png", width: 440, height: 280, transparent: false },
  { source: "promo/marquee.html", out: "promo-marquee.png", width: 1400, height: 560, transparent: false },
];

for (const a of art) {
  test(`store art: ${a.out} rendered from ${a.source} at ${a.width}×${a.height}`, async ({ browser }) => {
    const page = await browser.newPage({
      viewport: { width: a.width, height: a.height },
      deviceScaleFactor: 1,
    });
    await page.goto(pathToFileURL(resolve(storeDir, a.source)).href);
    await page.waitForLoadState("networkidle");
    const file = resolve(storeDir, a.out);
    await page.screenshot({ path: file, omitBackground: a.transparent });
    expect(pngSize(file), `${a.out} size`).toEqual({ width: a.width, height: a.height });
    await page.close();
  });
}
