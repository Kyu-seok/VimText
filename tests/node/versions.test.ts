import { it, expect } from "vitest";
import { readJson } from "./repo";

/**
 * The manifest and package.json each keep a version, bumped by hand (spec #27,
 * "Version sources"). The package script and the release tag read the
 * manifest's; npm and the Release read package.json's. This check is what
 * refuses a commit that bumps one and not the other.
 */
it("manifest.json and package.json agree on the version", () => {
  const manifest = readJson("manifest.json").version;
  const pkg = readJson("package.json").version;
  expect(manifest, `manifest.json is ${manifest} but package.json is ${pkg}`).toBe(pkg);
});
