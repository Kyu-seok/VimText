import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { repoPath } from "./repo";

/**
 * The Web Store's rules for the images uploaded beside the screenshots
 * (docs/store/listing.md, "Store listing"): the store icon is 128×128 with
 * transparency, so its 96×96 artwork sits in 16px of transparent padding; the
 * promo tiles are 440×280 and 1400×560, opaque 24-bit. `npm run screenshots`
 * renders all three (tests/screenshots/store-art.spec.ts); this check holds
 * the committed files to the rules inside the gate. Size and colour type are
 * read from the PNG's IHDR chunk: colour type 6 is RGBA, 2 is RGB.
 */
function ihdr(relPath: string): { width: number; height: number; colourType: number } {
  const png = readFileSync(repoPath(relPath));
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), colourType: png[25]! };
}

it.each([
  ["docs/store/icon-128.png", { width: 128, height: 128, colourType: 6 }],
  ["docs/store/promo-small.png", { width: 440, height: 280, colourType: 2 }],
  ["docs/store/promo-marquee.png", { width: 1400, height: 560, colourType: 2 }],
])("%s has the store's size and transparency", (file, expected) => {
  expect(ihdr(file)).toEqual(expected);
});
