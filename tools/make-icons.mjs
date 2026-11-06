// Dependency-free PNG icon generator for VimText.
// Draws a rounded dark-green tile with a light "block cursor" — evoking a
// terminal caret — at 16/48/128 px. Run: `node tools/make-icons.mjs`.
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "icons");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function draw(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const bg = [11, 110, 79, 255]; // #0b6e4f vim green
  const fg = [225, 245, 235, 255]; // light block cursor
  const r = size * 0.18; // corner radius
  // block-cursor rectangle (lower-right-ish, like a terminal caret)
  const bx0 = size * 0.32,
    bx1 = size * 0.62,
    by0 = size * 0.3,
    by1 = size * 0.72;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // rounded-corner transparency
      let inside = true;
      const cx = Math.min(x, size - 1 - x);
      const cy = Math.min(y, size - 1 - y);
      if (cx < r && cy < r) {
        const dx = r - cx,
          dy = r - cy;
        if (dx * dx + dy * dy > r * r) inside = false;
      }
      let col = bg;
      if (x >= bx0 && x <= bx1 && y >= by0 && y <= by1) col = fg;
      if (!inside) {
        rgba[i] = 0;
        rgba[i + 1] = 0;
        rgba[i + 2] = 0;
        rgba[i + 3] = 0;
      } else {
        rgba[i] = col[0];
        rgba[i + 1] = col[1];
        rgba[i + 2] = col[2];
        rgba[i + 3] = col[3];
      }
    }
  }
  return rgba;
}

fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  const png = encodePng(size, draw(size));
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), png);
  console.log(`wrote icons/icon${size}.png (${png.length} bytes)`);
}
