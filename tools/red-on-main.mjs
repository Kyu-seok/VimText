// Runs tests against main's source with this tree's tests in place: the check behind a
// "red on main" claim (CODING_STANDARDS rule 11, docs/agents/issue-tracker.md).
//
//   npm run red-on-main -- tests/e2e/<name>.spec.ts tests/unit/<name>.test.ts ...
//
// src/ and popup/ are copied aside (untracked files included), set to main's version in the
// working tree only (the index is left alone), the tests run, and the copy comes back, then
// a rebuild. Nothing goes through `git stash`: every worktree shares one stash list, and in
// #75 two implementers popped each other's stash. A *.spec.ts runs on the built extension
// (e2e project), a *.test.ts in the Chromium unit project. Exit 0 when every file is red on
// main, 1 when any is green there (the claim fails), 2 on a usage or restore error.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const files = process.argv.slice(2);
const specs = files.filter((f) => f.endsWith(".spec.ts"));
const units = files.filter((f) => f.endsWith(".test.ts"));
if (!files.length || specs.length + units.length !== files.length) {
  console.error("red-on-main: pass tests/e2e/*.spec.ts and tests/unit/*.test.ts files");
  process.exit(2);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const dirs = ["src", "popup"];
// The worktree's own git dir, so parallel worktrees never share the copy.
const aside = mkdtempSync(join(resolve(git("rev-parse", "--git-dir")), "red-on-main-"));
for (const d of dirs) cpSync(d, join(aside, d), { recursive: true });

let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
    cpSync(join(aside, d), d, { recursive: true });
  }
  rmSync(aside, { recursive: true, force: true });
}
process.on("SIGINT", () => {
  restore();
  process.exit(2);
});

const run = (cmd, args) => spawnSync(cmd, args, { stdio: "inherit" }).status === 0;
const green = [];
try {
  // main's files only: a file the branch added must not survive into main's build.
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  git("restore", "--source=main", "--worktree", "--", ...dirs);
  if (units.length && run("npx", ["vitest", "run", "--project", "chromium", ...units])) green.push(...units);
  if (specs.length) {
    if (!run("npm", ["run", "build"])) throw new Error("main's source did not build");
    if (run("npx", ["playwright", "test", "--project=e2e", "--retries=0", ...specs])) green.push(...specs);
  }
} catch (e) {
  console.error(`red-on-main: ${e.message}`);
  restore();
  process.exit(2);
}
restore();
if (specs.length && !run("npm", ["run", "build"])) {
  console.error("red-on-main: source restored, but the rebuild failed; run `npm run build`");
  process.exit(2);
}
// A file is red when any test in it fails: the output above names which.
if (green.length) {
  console.error(`red-on-main: green on main: ${green.join(", ")}`);
  process.exit(1);
}
console.log("red-on-main: every file is red on main");
