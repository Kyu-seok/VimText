import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoPath } from "./repo";

/**
 * The commit-msg hook's check, run as git runs it: a child process in the
 * repository, given the message file, observed through its exit code and
 * stderr. Each case stages a change in a throwaway repository.
 */

const script = repoPath("tools/check-owner-decision.mjs");

/** No inherited GIT_* variable or user git config (see tests/node/package.test.ts). */
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "vimtext-owner-"));
  roots.push(root);
  mkdirSync(join(root, "docs", "adr"), { recursive: true });
  writeFileSync(join(root, "CODING_STANDARDS.md"), "1. a rule\n");
  writeFileSync(join(root, "docs", "adr", "0001-a.md"), "# A\n");
  writeFileSync(join(root, "README.md"), "readme\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env });
  git("init", "-q");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  return root;
}

function stage(root: string, path: string, text: string): void {
  writeFileSync(join(root, path), text);
  execFileSync("git", ["add", path], { cwd: root, env });
}

function check(root: string, message: string) {
  writeFileSync(join(root, ".msg"), message);
  return spawnSync("node", [script, join(root, ".msg")], { cwd: root, env, encoding: "utf8" });
}

describe("a commit that changes a settled rule names the owner's decision", () => {
  it("refuses a change to CODING_STANDARDS.md without the trailer, naming the file", () => {
    const root = repo();
    stage(root, "CODING_STANDARDS.md", "1. a wider rule\n");
    const run = check(root, "docs: widen rule 1\n");
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("CODING_STANDARDS.md");
  });

  it("refuses a change to an existing ADR without the trailer", () => {
    const root = repo();
    stage(root, "docs/adr/0001-a.md", "# A, amended\n");
    expect(check(root, "docs: amend ADR 1\n").status).toBe(1);
  });

  it("takes the change with an Owner-decision trailer", () => {
    const root = repo();
    stage(root, "CODING_STANDARDS.md", "1. a wider rule\n");
    expect(check(root, "docs: widen rule 1\n\nOwner-decision: #52\n").status).toBe(0);
  });

  it("does not count a trailer that is only in a git comment line", () => {
    const root = repo();
    stage(root, "CODING_STANDARDS.md", "1. a wider rule\n");
    expect(check(root, "docs: widen rule 1\n# Owner-decision: #52\n").status).toBe(1);
  });

  it("takes a new ADR and a commit that touches neither file without a trailer", () => {
    const root = repo();
    stage(root, "docs/adr/0002-b.md", "# B\n");
    stage(root, "README.md", "readme, edited\n");
    expect(check(root, "docs: ADR 2\n").status).toBe(0);
  });
});
