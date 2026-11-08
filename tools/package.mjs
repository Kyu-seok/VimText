// Builds and zips the extension for the Chrome Web Store: release/vimtext-<version>.zip
// with manifest.json at the zip root. Refuses when the two version files disagree, when the
// working tree is dirty, or when the tag it is given (--expect-tag, the release workflow passes
// the pushed tag) is not v plus the manifest version. It does not run the gate: the pre-push
// hook and the release workflow do. See docs/release.md.
//
// `npm run package [-- --expect-tag v1.2.3]` is the real path. The Node tests run the script
// against a throwaway repository with `--root <dir> --no-build`, which zips `<dir>/dist` as it
// stands instead of rebuilding it.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : (args[i + 1] ?? "");
}
const root = resolve(flag("--root") ?? process.cwd());
const build = !args.includes("--no-build");

function refuse(message) {
  console.error(`package: ${message}`);
  process.exit(1);
}

// The checks come first: a refusal should not wait on a build it cannot use.
const readJson = (rel) => JSON.parse(readFileSync(resolve(root, rel), "utf8"));
const version = readJson("manifest.json").version;
const pkgVersion = readJson("package.json").version;
if (version !== pkgVersion) refuse(`manifest.json is ${version} but package.json is ${pkgVersion}`);

const expectedTag = flag("--expect-tag");
if (expectedTag !== undefined && expectedTag !== `v${version}`)
  refuse(`the tag is ${expectedTag} but manifest.json is ${version} (the tag should be v${version})`);

const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim();
if (dirty) refuse(`the working tree is not clean:\n${dirty}`);

// The production build (tools/build.mjs resolves its paths against the cwd).
if (build) {
  const buildScript = fileURLToPath(new URL("./build.mjs", import.meta.url));
  execFileSync(process.execPath, [buildScript], { cwd: root, stdio: "inherit" });
}

// Zip the *contents* of dist/ so manifest.json sits at the zip root, as the store requires.
// The zip tool adds to an existing archive, so a stale one is removed first.
const dist = resolve(root, "dist");
const releaseDir = resolve(root, "release");
const zipPath = resolve(releaseDir, `vimtext-${version}.zip`);
mkdirSync(releaseDir, { recursive: true });
rmSync(zipPath, { force: true });
execFileSync("zip", ["-r", "-X", "-q", zipPath, "."], { cwd: dist, stdio: "inherit" });
console.log(`package: ${zipPath}`);
