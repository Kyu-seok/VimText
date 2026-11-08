import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoPath } from "./repo";

/**
 * The package script is run the way the release workflow runs it, as a child
 * process, and observed through its exit code, its stderr and the zip's file
 * listing (spec #27, Testing Decisions, seam 1). It runs against a throwaway
 * git repository in the temp folder with `--root`, and with `--no-build` it
 * zips the `dist/` folder as it finds it, so no test runs esbuild.
 */

const packageScript = repoPath("tools/package.mjs");

/**
 * The pre-commit hook runs `npm test` with GIT_DIR and GIT_INDEX_FILE exported.
 * Inherited, they would point the fake repository's git, and the script's
 * `git status`, at VimText's own repository (the first run committed "fake
 * repo" there). The children get an environment without any GIT_* variable.
 */
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));

/** A committed repo shaped like VimText: the two version files, a gitignored dist/ and release/. */
function fakeRepo(manifestVersion: string, packageVersion = manifestVersion): string {
  const root = mkdtempSync(join(tmpdir(), "vimtext-package-"));
  writeFileSync(join(root, "manifest.json"), JSON.stringify({ name: "VimText", version: manifestVersion }));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "vimtext", version: packageVersion }));
  writeFileSync(join(root, ".gitignore"), "dist/\nrelease/\n");
  mkdirSync(join(root, "dist", "popup"), { recursive: true });
  writeFileSync(join(root, "dist", "manifest.json"), JSON.stringify({ version: manifestVersion }));
  writeFileSync(join(root, "dist", "content.js"), "// content");
  writeFileSync(join(root, "dist", "popup", "popup.html"), "<p>popup</p>");
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args], {
      cwd: root,
      env,
      stdio: "pipe",
    });
  git("init", "-q");
  git("add", "-A");
  git("-c", "commit.gpgsign=false", "commit", "-q", "-m", "fake repo");
  return root;
}

function runPackage(root: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [packageScript, "--root", root, "--no-build", ...args], {
    encoding: "utf8",
    env,
  });
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}

describe("tools/package.mjs", () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("refuses when manifest.json and package.json disagree on the version, naming both", () => {
    root = fakeRepo("0.2.0", "0.3.0");
    const { status, stderr } = runPackage(root);
    expect(status).not.toBe(0);
    expect(stderr).toContain("0.2.0");
    expect(stderr).toContain("0.3.0");
  });

  it("refuses when the working tree is dirty, naming the file", () => {
    root = fakeRepo("0.2.0");
    writeFileSync(
      join(root, "manifest.json"),
      JSON.stringify({ name: "VimText", version: "0.2.0", edited: true }),
    );
    const { status, stderr } = runPackage(root);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/not clean/);
    expect(stderr).toContain("manifest.json");
  });

  it("refuses when --expect-tag is not v plus the manifest version, naming both", () => {
    root = fakeRepo("0.2.0");
    const { status, stderr } = runPackage(root, "--expect-tag", "v9.9.9");
    expect(status).not.toBe(0);
    expect(stderr).toContain("v9.9.9");
    expect(stderr).toContain("0.2.0");
  });

  it("on a clean tree with agreeing versions zips dist/ as release/vimtext-<version>.zip, manifest at the root", () => {
    root = fakeRepo("1.2.3");
    const { status, stderr } = runPackage(root, "--expect-tag", "v1.2.3");
    expect(status, stderr).toBe(0);
    const zip = join(root, "release", "vimtext-1.2.3.zip");
    expect(existsSync(zip), `${zip} exists`).toBe(true);
    const listing = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n").sort();
    expect(listing).toEqual(["content.js", "manifest.json", "popup/", "popup/popup.html"]);
  });
});
