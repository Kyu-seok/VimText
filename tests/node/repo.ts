import { readFileSync } from "node:fs";

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
