# Cutting a release

A release is a version bump, a release commit and an annotated tag. Pushing the tag does the
rest: the `release` workflow (`.github/workflows/release.yml`) runs the gate, packages the zip
and publishes a GitHub Release. Uploading that zip to the Chrome Web Store is a human step.
Terms as in `GLOSSARY.md`; the decisions behind this procedure are in spec #27.

## Procedure

1. **Bump both versions.** `manifest.json` and `package.json` each keep a version, bumped by
   hand. `npm test` (the Node project, `tests/node/versions.test.ts`) refuses a commit that
   bumps one and not the other.
2. **Make the release commit**: `chore: release <version> — <milestone>`, for example
   `chore: release 0.3.0 — M3`.
3. **Tag it with an annotated tag whose message is the release notes**:
   `git tag -a v<version>` and write the notes in the editor (or `-F <file>`). The notes are
   drafted in `docs/store/announcements.md` (ticket #32); the tag message is what the Release
   shows as its body, so write it for the reader of the Releases page. A change to
   `PRIVACY.md` is noted here.
4. **Push the commit, then the tag**: `git push && git push origin v<version>`. The pre-push
   hook runs the gate locally; the workflow runs it again on the runner, then
   `npm run package -- --expect-tag v<version>`, then `gh release create` with the zip
   attached and the tag message as the notes.
5. **Download the zip from the Release** (`vimtext-<version>.zip`) and **upload it in the
   developer dashboard**. The dashboard texts come from `docs/store/` (ticket #31). Submit for
   review.
6. **After approval**, post the announcements drafted in `docs/store/announcements.md`.

A tag is cut once. If the store rejects the submission, fix the finding and ship it as the
**next patch version** (`0.3.0` rejected becomes `0.3.1`): bump, commit, tag, push again. Never
delete and re-cut a tag: the tag, the Release and the uploaded zip must always agree, and the
store never sees a version twice.

## The package script

`npm run package` (`tools/package.mjs`) is what the workflow runs and what a local check of
the zip runs. It:

- refuses when `manifest.json` and `package.json` disagree on the version, when the working
  tree is dirty (`git status --porcelain`), or when `--expect-tag <tag>` is given and the tag is
  not `v` plus the manifest version, each with a non-zero exit and a message on stderr naming
  both values;
- runs the production build (`tools/build.mjs`);
- zips the _contents_ of `dist/` with the `zip` command-line tool into the gitignored
  `release/vimtext-<version>.zip`, so `manifest.json` sits at the zip root with `content.js`,
  `background.js`, `popup/`, `options/` and `icons/` beside it, which is the layout the store
  expects.

It does not run the gate: the pre-push hook and the workflow do. Its tests run it as a child
process against a throwaway repository (`tests/node/package.test.ts`).

## Permission choices

Recorded here and in the store listing's justifications rather than in an ADR: narrowing a
permission later is free, while widening one prompts every user again, so these are the
choices to keep in mind when touching the manifest.

- **Host match `http://*/*`, `https://*/*` with `all_frames: true`.** VimText is inert on a
  page until the user presses Esc in a focused Field (Activate); the content script must
  already be there to hear that key, in every frame, because comment boxes and editors often
  live in an embedded frame. There is no narrower match that still works on every site, and
  the Site Policy is where the user turns VimText off for a Site. The script reads only the
  Field the user Activated (`PRIVACY.md`).
- **`clipboardRead` and `clipboardWrite` at install time, not requested at first use.** They
  back the `"+` and `"*` registers only: the clipboard is read on a `"+`/`"*` paste and
  written on a `"+`/`"*` yank, never otherwise. Requesting them on first use would interrupt
  a paste with a prompt in the middle of an editing command, and the install prompt already
  shows them once.
- **`storage`.** Settings (Site Policies, the vimrc, Plugin toggles) in sync storage, so they
  travel with Chrome Sync when the user has it on; registers, macros and history (Session
  State) in session storage, gone when the browser closes.

## What the machine checks and what it does not

The Node project checks the version agreement and the package script's refusals and zip layout.
The workflow's only logic is in the package script, so its proof is the first tag run; the
dashboard submission, the listing prose and the privacy policy are reviewed by a human.
