// commit-msg hook (.husky/commit-msg): a commit that changes CODING_STANDARDS.md
// or an existing ADR records the owner's decision behind it, as a trailer
//
//   Owner-decision: #<issue>
//
// naming the issue or comment where the owner decided. A new ADR needs none:
// it is written in a grilling with the owner. A merge commit is skipped: the
// commits it brings in passed this hook when they were made.
//
// Why (retro of #41): an implementer widened CODING_STANDARDS rule 4 on its own
// (#64) after the owner had accepted a narrower exception (#52), and nothing
// stopped it. An implementer that needs a settled rule changed stops and reports.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const messageFile = process.argv[2];
if (!messageFile) {
  console.error("check-owner-decision: usage: check-owner-decision.mjs <commit message file>");
  process.exit(2);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });

const merging = (() => {
  try {
    git("rev-parse", "-q", "--verify", "MERGE_HEAD");
    return true;
  } catch {
    return false;
  }
})();
if (merging) process.exit(0);

const settled = git("diff", "--cached", "--name-status", "--no-renames")
  .split("\n")
  .filter(Boolean)
  .map((line) => line.split("\t"))
  .filter(
    ([status, path]) =>
      path === "CODING_STANDARDS.md" || (/^docs\/adr\/.+\.md$/.test(path) && status !== "A"),
  )
  .map(([, path]) => path);
if (settled.length === 0) process.exit(0);

const message = readFileSync(messageFile, "utf8")
  .split("\n")
  .filter((line) => !line.startsWith("#"))
  .join("\n");
if (/^Owner-decision: #\d+/m.test(message)) process.exit(0);

console.error(
  `check-owner-decision: this commit changes ${settled.join(", ")}, which the owner settles.\n` +
    "Add a trailer naming the issue where the owner decided, e.g.\n\n  Owner-decision: #52\n\n" +
    "No decision yet? Leave the file as it is and ask the owner (CODING_STANDARDS rule 10).",
);
process.exit(1);
