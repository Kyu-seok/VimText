import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoPath } from "./repo";
import { decodePng } from "../png";

/**
 * `npm run icons` (tools/make-icons.mjs) renders the manifest's icons from
 * their sources in Playwright's Chromium (#39). It is run as a child process
 * with `--out <dir>`, twice into two throwaway folders, and observed through
 * the PNGs it writes. The committed icons are not compared: the text is set in
 * Menlo, which the Linux runner lacks, so only a macOS render matches them.
 */

const makeIcons = repoPath("tools/make-icons.mjs");
const sizes = [16, 48, 128];

function render(): string {
  const out = mkdtempSync(join(tmpdir(), "vimtext-icons-"));
  const result = spawnSync(process.execPath, [makeIcons, "--out", out], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  return out;
}

/** An icon's alpha channel (tests/png.ts decodes it). */
function alpha(png: Buffer): {
  width: number;
  height: number;
  colourType: number;
  at: (x: number, y: number) => number;
} {
  const decoded = decodePng(png);
  return { ...decoded, at: (x, y) => decoded.at(x, y)[3] };
}

describe("tools/make-icons.mjs", () => {
  let first: string;
  let second: string;
  beforeAll(() => {
    first = render();
    second = render();
  }, 60_000);
  afterAll(() => {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  });

  it("writes exactly the manifest's three icons", () => {
    expect(readdirSync(first).sort()).toEqual(["icon128.png", "icon16.png", "icon48.png"]);
  });

  it("writes byte-identical files when run twice", () => {
    for (const size of sizes) {
      const name = `icon${size}.png`;
      expect(readFileSync(join(first, name)).equals(readFileSync(join(second, name))), name).toBe(true);
    }
  });

  it.each(sizes)("icon%i.png is that size, with transparency", (size) => {
    const png = alpha(readFileSync(join(first, `icon${size}.png`)));
    expect({ width: png.width, height: png.height, colourType: png.colourType }).toEqual({
      width: size,
      height: size,
      colourType: 6,
    });
  });

  it("the 128 and 48 px icons keep the store icon's transparent padding", () => {
    for (const size of [48, 128]) {
      const png = alpha(readFileSync(join(first, `icon${size}.png`)));
      expect(png.at(0, size / 2), `icon${size}.png left edge`).toBe(0);
      expect(png.at(size / 2, size / 2), `icon${size}.png centre`).toBe(255);
    }
  });

  it("the 16 px tile fills the canvas with at most 1 px of padding", () => {
    const png = alpha(readFileSync(join(first, "icon16.png")));
    for (const [x, y] of [
      [1, 8],
      [14, 8],
      [8, 1],
      [8, 14],
    ] as const) {
      expect(png.at(x, y), `pixel ${x},${y}`).toBe(255);
    }
  });
});
