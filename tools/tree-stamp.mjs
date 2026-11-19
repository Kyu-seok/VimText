// Tells a gate that ran on one tree from a gate whose tree changed under it.
//
//   node tools/tree-stamp.mjs record   # first step of `npm run check`
//   node tools/tree-stamp.mjs verify   # its last step
//
// `npm run check` typechecks, tests, then builds and runs the e2e suite on that build, over
// several minutes. A file edited meanwhile is in some of those steps and not in others, and a
// green gate then says nothing about the tree that is there at the end: in #79 an implementer
// edited src/ while the gate ran and had to run it again. `record` hashes every file git does
// not ignore (tracked or not) into the worktree's own git dir; `verify` exits 1 and names the
// files that differ.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const stampFile = join(resolve(git("rev-parse", "--git-dir").trim()), "gate-tree-stamp.json");

/** Each unignored file's content hash; a file deleted from the working tree hashes as "gone". */
function stamp() {
  const files = git("ls-files", "-co", "--exclude-standard", "-z").split("\0").filter(Boolean);
  const hashes = {};
  for (const f of [...new Set(files)].sort())
    hashes[f] = existsSync(f) ? createHash("sha256").update(readFileSync(f)).digest("hex") : "gone";
  return hashes;
}

const mode = process.argv[2];
if (mode === "record") {
  writeFileSync(stampFile, JSON.stringify(stamp()));
} else if (mode === "verify") {
  if (!existsSync(stampFile)) {
    console.error("tree-stamp: nothing recorded; run `node tools/tree-stamp.mjs record` first");
    process.exit(2);
  }
  const before = JSON.parse(readFileSync(stampFile, "utf8"));
  const after = stamp();
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((f) => before[f] !== after[f])
    .sort();
  if (changed.length) {
    console.error(
      `tree-stamp: the tree changed during the gate, so its result is for neither tree. Run it again.`,
    );
    for (const f of changed) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log("tree-stamp: the tree is the one the gate started on");
} else {
  console.error("tree-stamp: pass `record` or `verify`");
  process.exit(2);
}
