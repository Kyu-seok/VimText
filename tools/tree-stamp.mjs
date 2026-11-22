// Tells a run that was made on one tree from a run whose tree changed under it, and
// remembers which tree a run passed on.
//
//   node tools/tree-stamp.mjs record [name]   # a run's first step
//   node tools/tree-stamp.mjs verify [name]   # its last step
//   node tools/tree-stamp.mjs passed [name]   # exit 0 when that run passed on this very tree
//
// `name` is the run: `gate` (the default, `npm run check`) or `editors`
// (`npm run test:e2e:editors`).
//
// `npm run check` typechecks, tests, then builds and runs the e2e suite on that build, over
// several minutes. A file edited meanwhile is in some of those steps and not in others, and a
// green gate then says nothing about the tree that is there at the end: in #79 an implementer
// edited src/ while the gate ran and had to run it again. `record` hashes every file git does
// not ignore (tracked or not) into the worktree's own git dir; `verify` exits 1 and names the
// files that differ.
//
// A `verify` that succeeds is the run's last step, so the run passed on that tree, and it
// leaves the tree's digest as the mark `passed` reads. Pre-push asks `passed` before each of
// its runs and skips one already made: implementing #90, the gate and the editors' run were
// green on the tree, the push made both again, seven minutes, and a flaky test in that second
// editors' run refused the push. `passed` also wants nothing uncommitted, so the tree that
// passed is the commit being pushed. Any other tree gets the full run.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const gitDir = resolve(git("rev-parse", "--git-dir").trim());
const [mode, name = "gate"] = process.argv.slice(2);
const stampFile = join(gitDir, `${name}-tree-stamp.json`);
const passedFile = join(gitDir, `${name}-passed-tree.txt`);

/** Each unignored file's content hash; a file deleted from the working tree hashes as "gone". */
function stamp() {
  const files = git("ls-files", "-co", "--exclude-standard", "-z").split("\0").filter(Boolean);
  const hashes = {};
  for (const f of [...new Set(files)].sort())
    hashes[f] = existsSync(f) ? createHash("sha256").update(readFileSync(f)).digest("hex") : "gone";
  return hashes;
}

const digest = (hashes) => createHash("sha256").update(JSON.stringify(hashes)).digest("hex");

if (mode === "record") {
  writeFileSync(stampFile, JSON.stringify(stamp()));
} else if (mode === "verify") {
  if (!existsSync(stampFile)) {
    console.error(`tree-stamp: nothing recorded; run \`node tools/tree-stamp.mjs record ${name}\` first`);
    process.exit(2);
  }
  const before = JSON.parse(readFileSync(stampFile, "utf8"));
  const after = stamp();
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((f) => before[f] !== after[f])
    .sort();
  if (changed.length) {
    console.error(
      `tree-stamp: the tree changed during the ${name === "gate" ? "gate" : `${name} run`}, so its result is for neither tree. Run it again.`,
    );
    for (const f of changed) console.error(`  ${f}`);
    process.exit(1);
  }
  writeFileSync(passedFile, digest(after));
  console.log(`tree-stamp: the tree is the one the ${name === "gate" ? "gate" : `${name} run`} started on`);
} else if (mode === "passed") {
  const run = name === "gate" ? "the gate" : `the ${name} run`;
  if (git("status", "--porcelain").trim()) {
    console.log(`tree-stamp: uncommitted changes, so ${run} is made on this tree`);
    process.exit(1);
  }
  if (!existsSync(passedFile) || readFileSync(passedFile, "utf8") !== digest(stamp())) {
    console.log(`tree-stamp: ${run} has not passed on this tree`);
    process.exit(1);
  }
  console.log(`tree-stamp: ${run} passed on this tree; not made again`);
} else {
  console.error("tree-stamp: pass `record`, `verify` or `passed`, and the run's name (default `gate`)");
  process.exit(2);
}
