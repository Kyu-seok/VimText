# Cutting a release

A release is a version bump, a release commit and an annotated tag. Pushing the tag does the
rest: the `release` workflow (`.github/workflows/release.yml`) runs the gate, packages the zip
and publishes a GitHub Release. Uploading that zip to the Chrome Web Store is a human step.
Terms as in `GLOSSARY.md`; the decisions behind this procedure are in spec #27.

## Procedure

A store release is gated by the [dogfooding pass](#dogfooding-pass) on the build from `main`.

1. **Bump both versions.** `manifest.json` and `package.json` each keep a version, bumped by
   hand. `npm test` (the Node project, `tests/node/versions.test.ts`) refuses a commit that
   bumps one and not the other.
2. **Make the release commit**: `chore: release <version> — <milestone>`, for example
   `chore: release 0.3.0 — M3`.
3. **Tag it with an annotated tag whose message is the release notes**:
   `git tag -a v<version>` and write the notes in the editor (or `-F <file>`). The notes are
   drafted in `docs/store/announcements.md` (ticket #32); the tag message is what the Release
   shows as its body, so write it for the reader of the Releases page. A change to
   `PRIVACY.md` is noted here. The tag message never changes after the push, so the notes
   name only what exists at tag time: no store URL before the first upload
   (`tests/node/release-notes.test.ts` refuses a `<PLACEHOLDER>` token).
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

## Dogfooding pass

The submission gate for a store release (DESIGN.md "Milestones" holds the blocker rule: a
finding that corrupts text, traps the page or throws blocks; anything else is filed
`needs-triage`). One comment per site on the gate ticket.

**Load the build under test.** `npm run build`, reload VimText in `chrome://extensions`, then
refresh every tab you test in: a tab open before the reload keeps the old content script, or
none. In the 0.3.0 pass a stale tab read as "GitHub does not work".

**On each site,** in the box named below, with the console open:

1. Type two lines (one where Enter submits); Esc shows `--NORMAL--` under the box.
2. `gg` `dd` (one line: `0dw`); `u` restores it.
3. Visual: `j w v e d` (one line: `w v e d`) deletes one word.
4. `i`, a word, Esc: inserted at the cursor.
5. Copy text elsewhere on a page; `"+p` pastes it after the cursor.
6. Submit with the site's own button; the posted text is what Vim would leave.
7. No console errors.

**Which box, per site** (re-check when a site redesigns):

- **GitHub**: the issue or PR comment box, a `<textarea>`.
- **Hacker News**: the reply box on a recent item (old items are closed to replies), a `<textarea>`.
- **Stack Overflow**: the "Add a comment" box, a `<textarea>`; Enter submits it, so one line;
  commenting on others' posts needs 50 reputation. The answer editor is the Stacks Editor
  (ProseMirror, contenteditable): an M4 case, not a finding.
- **Reddit**: the comment composer is rich text (contenteditable, M4) and its Markdown switch
  was not found in 2026-11; `old.reddit.com` has a `<textarea>`. Claude in Chrome cannot open
  reddit.com.

**An agent driving the pass** (Claude in Chrome): focus the box with `element.focus()` from
the page's JavaScript, not a coordinate click (a late layout shift sent keys to the page),
send keys, and assert the Field's `.value` after each step. Posting publicly is the user's
call; ask before step 6.

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
  written when a yank, delete or change stores text into `"+`/`"*`, never otherwise.
  Requesting them on first use would interrupt a paste with a prompt in the middle of an
  editing command, and the install prompt already shows them once.
- **`storage`.** Settings (Site Policies, the vimrc, Plugin toggles) in sync storage, so they
  travel with Chrome Sync when the user has it on; registers, macros and history (Session
  State) in session storage, gone when the browser closes.

## What the machine checks and what it does not

What `npm test` checks of a release (the Node project's entries) is inventoried under
"Mechanical" in `CODING_STANDARDS.md` and summarised in `DESIGN.md` "Tooling". The workflow's
only logic is in the package script, so its proof is the first tag run; the dashboard
submission, the listing prose and the privacy policy are reviewed by a human.
