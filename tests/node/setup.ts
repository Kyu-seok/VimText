// Git exports GIT_DIR and GIT_INDEX_FILE to its hooks, so the pre-commit and
// pre-push hooks run `npm test` with them set. A Node test that spawns git
// inherits them, and that git acts on VimText's own repository instead of the
// folder it was run in: a `git init` in the temp folder once set `core.bare` on
// the real checkout and committed into the working branch. Every Node test
// starts without any GIT_* variable.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("GIT_")) delete process.env[key];
}
