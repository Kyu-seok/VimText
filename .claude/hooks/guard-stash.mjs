// PreToolUse hook (Bash): asks before any `git stash` while `git worktree list` shows more
// than one worktree. Every worktree shares one stash list, so a pop can take another
// worktree's entry. Retro of #75: two parallel implementers popped each other's stash.
import { execFileSync } from "node:child_process";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const command = JSON.parse(input).tool_input?.command ?? "";

if (/\bgit\s+stash\b/.test(command)) {
  let worktrees = 0;
  try {
    worktrees = execFileSync("git", ["worktree", "list", "--porcelain"], { encoding: "utf8" })
      .split("\n")
      .filter((line) => line.startsWith("worktree ")).length;
  } catch {
    // Not in a repository: no stash list to share.
  }
  if (worktrees > 1) {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: `${worktrees} worktrees share one stash list, so a pop can take another worktree's entry. Save the changes with \`git diff > "$(git rev-parse --git-dir)/x.patch"\` instead.`,
        },
      }),
    );
  }
}
