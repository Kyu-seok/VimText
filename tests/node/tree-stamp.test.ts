import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoPath } from "./repo";

/**
 * The gate's first and last step, run as `npm run check` runs them: a child
 * process in a throwaway repository, observed through its exit code and
 * stderr.
 */

const script = repoPath("tools/tree-stamp.mjs");

/** No inherited GIT_* variable or user git config (see tests/node/package.test.ts). */
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "vimtext-stamp-"));
  roots.push(root);
  writeFileSync(join(root, "tracked.ts"), "one\n");
  writeFileSync(join(root, ".gitignore"), "dist/\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env });
  git("init", "-q");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  return root;
}

const stamp = (root: string, mode: string) =>
  spawnSync("node", [script, mode], { cwd: root, env, encoding: "utf8" });

describe("the gate notices a tree that changed while it ran", () => {
  it("verify passes on the tree that was recorded, a build's ignored output aside", () => {
    const root = repo();
    expect(stamp(root, "record").status).toBe(0);
    execFileSync("mkdir", [join(root, "dist")]);
    writeFileSync(join(root, "dist", "built.js"), "built\n");
    expect(stamp(root, "verify").status).toBe(0);
  });

  it("verify fails and names an edited file, a new untracked one and a deleted one", () => {
    const root = repo();
    writeFileSync(join(root, "doomed.ts"), "going\n");
    stamp(root, "record");
    writeFileSync(join(root, "tracked.ts"), "two\n");
    writeFileSync(join(root, "new.ts"), "new\n");
    rmSync(join(root, "doomed.ts"));
    const result = stamp(root, "verify");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("the tree changed during the gate");
    expect(result.stderr.split("\n").filter((l) => l.startsWith("  "))).toEqual([
      "  doomed.ts",
      "  new.ts",
      "  tracked.ts",
    ]);
  });

  it("verify with nothing recorded is a usage error", () => {
    expect(stamp(repo(), "verify").status).toBe(2);
  });
});
