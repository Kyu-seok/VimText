// PreToolUse hook (Bash): asks before `git checkout <path>`, `git checkout -- <path>` or
// `git restore <path>` would throw away uncommitted changes to that path. A branch switch,
// or a path with nothing uncommitted, passes. Retro of #73: a checkout meant to drop debug
// lines reverted two edits that were not committed yet.
import { execFileSync } from "node:child_process";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const command = JSON.parse(input).tool_input?.command ?? "";

const at = [];
for (const m of command.matchAll(/\bgit\s+(checkout|restore)\b([^;&|]*)/g)) {
  const args = m[2].trim().split(/\s+/).filter(Boolean);
  if (m[1] === "restore" && args.includes("--staged") && !args.includes("--worktree")) continue;
  const dash = args.indexOf("--");
  const paths = dash >= 0 ? args.slice(dash + 1) : args.filter((a) => !a.startsWith("-"));
  for (const p of paths) {
    let changed = "";
    try {
      changed = execFileSync("git", ["status", "--porcelain", "--", p], { encoding: "utf8" }).trim();
    } catch {
      // Not a path git knows (a branch name): nothing to lose.
    }
    if (changed) at.push(p);
  }
}

if (at.length) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: `This discards uncommitted changes to ${at.join(", ")}. Commit what should stay first, or save it with git diff.`,
      },
    }),
  );
}
