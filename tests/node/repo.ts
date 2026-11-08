import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The repo-wide consistency checks read files the release workflow reads, so
 * every path is resolved against the repository root, not the process's cwd.
 */
const repoRoot = new URL("../../", import.meta.url);

export function readJson(relPath: string): Record<string, unknown> {
  return JSON.parse(readText(relPath));
}

export function readText(relPath: string): string {
  return readFileSync(new URL(relPath, repoRoot), "utf8");
}

/** A repository file as a filesystem path, for the checks that spawn it. */
export function repoPath(relPath: string): string {
  return fileURLToPath(new URL(relPath, repoRoot));
}
