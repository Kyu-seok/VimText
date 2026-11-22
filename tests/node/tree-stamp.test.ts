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

const stamp = (root: string, ...args: string[]) =>
  spawnSync("node", [script, ...args], { cwd: root, env, encoding: "utf8" });

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

/**
 * Pre-push asks whether a run already passed on the tree being pushed, so it
 * does not make the same run again: `verify` leaves the mark, `passed` reads
 * it. Each run has its own name (the gate's is the default, the editors'
 * repeated run is `editors`).
 */
describe("a run that passed on this tree is not made again", () => {
  const commit = (root: string) => {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env });
    git("add", ".");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "more");
  };

  it("passed succeeds once verify has, for that run's name only", () => {
    const root = repo();
    expect(stamp(root, "passed").status).toBe(1);
    stamp(root, "record");
    expect(stamp(root, "passed").status).toBe(1);
    expect(stamp(root, "verify").status).toBe(0);
    const passed = stamp(root, "passed");
    expect(passed.status).toBe(0);
    expect(passed.stdout).toContain("gate passed on this tree");
    expect(stamp(root, "passed", "editors").status).toBe(1);
    stamp(root, "record", "editors");
    stamp(root, "verify", "editors");
    expect(stamp(root, "passed", "editors").status).toBe(0);
  });

  it("a verify that fails leaves no mark", () => {
    const root = repo();
    stamp(root, "record");
    writeFileSync(join(root, "tracked.ts"), "two\n");
    expect(stamp(root, "verify").status).toBe(1);
    commit(root);
    expect(stamp(root, "passed").status).toBe(1);
  });

  it("passed fails on a tree that changed since, committed or not, and succeeds again on the tree that passed", () => {
    const root = repo();
    stamp(root, "record");
    stamp(root, "verify");
    writeFileSync(join(root, "tracked.ts"), "two\n");
    expect(stamp(root, "passed").status).toBe(1);
    commit(root);
    expect(stamp(root, "passed").status).toBe(1);
    writeFileSync(join(root, "tracked.ts"), "one\n");
    commit(root);
    expect(stamp(root, "passed").status).toBe(0);
  });

  it("passed fails while anything is uncommitted: the push carries the commit, not the working tree", () => {
    const root = repo();
    writeFileSync(join(root, "new.ts"), "new\n");
    stamp(root, "record");
    stamp(root, "verify");
    const dirty = stamp(root, "passed");
    expect(dirty.status).toBe(1);
    expect(dirty.stdout).toContain("uncommitted");
    commit(root);
    expect(stamp(root, "passed").status).toBe(0);
  });
});
