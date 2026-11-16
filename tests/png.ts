import { inflateSync } from "node:zlib";

/**
 * An 8-bit, non-interlaced PNG decoded to its pixels: RGB (colour type 2) or
 * RGBA (6), the two the repo reads. Shared by the icon checks
 * (tests/node/icons.test.ts) and the e2e tests that read what Chromium
 * painted (tests/e2e/drawn-cursor.spec.ts).
 */
export interface Png {
  width: number;
  height: number;
  colourType: number;
  /** The pixel at (x, y) as [r, g, b, a]; a is 255 in an RGB image. */
  at(x: number, y: number): [number, number, number, number];
}

export function decodePng(png: Buffer): Png {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const colourType = png[25]!;
  if (png[24] !== 8 || (colourType !== 2 && colourType !== 6) || png[28] !== 0)
    throw new Error(
      `decodePng: unsupported PNG (depth ${png[24]}, colour type ${colourType}, interlace ${png[28]})`,
    );
  const bpp = colourType === 6 ? 4 : 3;
  const idat: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    if (png.toString("ascii", at + 4, at + 8) === "IDAT") idat.push(png.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const rows: Buffer[] = [];
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp]! : 0;
      const b = previous[i]!;
      const c = i >= bpp ? previous[i - bpp]! : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c);
      const predictor = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter]!;
      line[i] = (line[i]! + predictor) & 0xff;
    }
    rows.push(line);
    previous = line;
  }
  return {
    width,
    height,
    colourType,
    at: (x, y) => {
      const row = rows[y]!;
      const i = x * bpp;
      return [row[i]!, row[i + 1]!, row[i + 2]!, bpp === 4 ? row[i + 3]! : 255];
    },
  };
}
