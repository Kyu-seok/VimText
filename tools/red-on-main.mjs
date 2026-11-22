// Runs tests against main's source with this tree's tests in place: the check behind a
// "red on main" claim (CODING_STANDARDS rule 11, docs/agents/issue-tracker.md).
//
//   npm run red-on-main -- tests/e2e/<name>.spec.ts tests/unit/<name>.test.ts ...
//   npm run red-on-main -- -g '#100' tests/e2e/<name>.spec.ts ...
//
// With `-g <pattern>` only the tests whose names match run (Playwright's `-g`, vitest's
// `-t`), and the claim is made of each one: a matching test that passes on main is named
// and fails the run, as does a file with no matching test. Rule 11 is about each new test,
// and a file is red as soon as one test in it fails: implementing #100, a new unit test
// that was green on main sat in a file another new test made red, and three whole specs
// (121 tests) ran on main to check the 30 new ones.
//
// src/ and popup/ are copied aside (untracked files included), set to main's version in the
// working tree only (the index is left alone), the tests run, and the copy comes back, then
// a rebuild. Nothing goes through `git stash`: every worktree shares one stash list, and in
// #75 two implementers popped each other's stash. A *.spec.ts runs on the built extension
// (e2e project), a *.test.ts in the Chromium unit project. Exit 0 when every file is red on
// main (with `-g`, every matching test), 1 when any is green there (the claim fails), 2 on a
// usage or restore error.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const at = args.indexOf("-g");
const pattern = at < 0 ? null : args[at + 1];
const files = at < 0 ? args : [...args.slice(0, at), ...args.slice(at + 2)];
const specs = files.filter((f) => f.endsWith(".spec.ts"));
const units = files.filter((f) => f.endsWith(".test.ts"));
if (!files.length || specs.length + units.length !== files.length || pattern === undefined) {
  console.error("red-on-main: pass [-g <pattern>] and tests/e2e/*.spec.ts and tests/unit/*.test.ts files");
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

/** The names of the tests that passed, and how many ran, per file, from vitest's JSON report. */
function unitResults(reportFile) {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  return report.testResults.map((file) => {
    const ran = file.assertionResults.filter((t) => t.status === "passed" || t.status === "failed");
    return {
      file: file.name,
      ran: ran.length,
      passed: ran.filter((t) => t.status === "passed").map((t) => t.fullName),
    };
  });
}

/** The same from Playwright's JSON report (playwright.config.ts writes it on every run). */
function specResults(reportFile) {
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  const byFile = new Map();
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      const entry = byFile.get(spec.file) ?? { file: spec.file, ran: 0, passed: [] };
      byFile.set(spec.file, entry);
      for (const test of spec.tests ?? []) {
        if (test.status === "skipped") continue;
        entry.ran++;
        if (test.status === "expected") entry.passed.push(spec.title);
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites ?? []) visit(suite);
  return [...byFile.values()];
}

/** With `-g`: every asked-for file ran a matching test, and none of them passed. */
function judgeEach(asked, results) {
  for (const f of asked) {
    const result = results.find(
      (r) => resolve(r.file) === resolve(f) || resolve("tests/e2e", r.file) === resolve(f),
    );
    if (!result?.ran) green.push(`${f}: no test matches ${JSON.stringify(pattern)}`);
    else for (const name of result.passed) green.push(`${f}: ${name}`);
  }
}

try {
  // main's files only: a file the branch added must not survive into main's build.
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  git("restore", "--source=main", "--worktree", "--", ...dirs);
  if (units.length && pattern === null) {
    if (run("npx", ["vitest", "run", "--project", "chromium", ...units])) green.push(...units);
  } else if (units.length) {
    const report = join(aside, "vitest.json");
    run("npx", [
      "vitest",
      "run",
      "--project",
      "chromium",
      "-t",
      pattern,
      "--reporter=default",
      "--reporter=json",
      `--outputFile.json=${report}`,
      ...units,
    ]);
    judgeEach(units, unitResults(report));
  }
  if (specs.length) {
    if (!run("npm", ["run", "build"])) throw new Error("main's source did not build");
    const allPassed = run("npx", [
      "playwright",
      "test",
      "--project=e2e",
      "--retries=0",
      ...(pattern === null ? [] : ["-g", pattern]),
      ...specs,
    ]);
    if (pattern !== null) judgeEach(specs, specResults("test-results/last-run-report.json"));
    else if (allPassed) green.push(...specs);
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
  console.error(`red-on-main: green on main:\n  ${green.join("\n  ")}`);
  process.exit(1);
}
console.log(`red-on-main: every ${pattern === null ? "file" : "matching test"} is red on main`);
