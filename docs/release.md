# Cutting a release

A release is a version bump, a release commit and an annotated tag. Pushing the tag does the
rest: the `release` workflow (`.github/workflows/release.yml`) runs the gate, packages the zip
and publishes a GitHub Release. Uploading that zip to the Chrome Web Store is a human step.
Terms as in `GLOSSARY.md`; the decisions behind this procedure are in spec #27.

## Procedure

A store release is gated by the [dogfooding pass](#dogfooding-pass) on the build from `main`.

1. **Bump both versions and add the release notes.** `manifest.json` and `package.json` each
   keep a version, bumped by hand, and the notes are `docs/release-notes/<version>.txt`.
   `npm test` (the Node project) refuses a commit that bumps one version and not the other
   (`tests/node/versions.test.ts`), or that bumps them without the notes file
   (`tests/node/release-notes.test.ts`).
2. **Make the release commit**: `chore: release <version> — <milestone>`, for example
   `chore: release 0.3.0 — M3`.
3. **Tag it with an annotated tag whose message is the release notes**:
   `git tag -a v<version> -F docs/release-notes/<version>.txt`. The file's first line is the
   Release's title (`VimText <version>: …`), the rest plain text; the tag message is what the
   Release shows as its body, so write it for the reader of the Releases page. A change to
   `PRIVACY.md` is noted here. The tag message never changes after the push, so the notes
   name only what exists at tag time: no store URL before the first upload (the same test
   refuses a `<PLACEHOLDER>` token). The 0.4.0 notes are also section 1 of
   `docs/store/announcements.md`, beside the announcements that quote them.
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

**An agent driving the pass** (Claude in Chrome): on every site, first run the output of
`npm run -s dogfood:probe` in the page (`tools/dogfood-probe.mjs`), then
`__vimtextProbe.watch(box)` on the box, with `{ enterSends: true }` where Enter sends or
submits (Slack, Stack Overflow's comment box). `watch` focuses the box from the page's
JavaScript (a coordinate click met a late layout shift and sent keys to the page), and from
then on a key that arrives while focus is outside the box is stopped and listed. Send keys,
and after each step assert on `__vimtextProbe.state()`: the text, the selection, `focused`
and an empty `leaks`. A batch of tool calls ends at the read that follows one step's keys,
and a non-empty `leaks` ends the run on that site: in the 0.4.2 pass focus left Gmail's
compose body mid-batch and the keys behind it ran Gmail's shortcuts on the inbox (#108).
Start the console capture (`read_console_messages`) right after navigating: it records
from its first call. Posting publicly is the user's call; ask before step 6.

### M4: contenteditable editors

Added for 0.4.0 (#56). The same blocker rule; "traps the page" includes a key the site needs
never arriving and a form that cannot be submitted or left. Sign-ins are the user's part.

**On each site,** in the rich editor named below, with the console open, after the steps above
(a contenteditable has no `.value`: read the box's `innerText`, and after each step type one
real character in Insert and delete it, to show the edit survived the editor's next render,
since an edit the editor's model never took comes back on its next render; that check is an
undo step of its own, so a `u` goes before it):

1. Line-wise: `o` a new line, `dd` it, `J` two lines, `u` and Ctrl-r each.
2. Inside a bold or italic run (make one with the site's own shortcut): `cw`, `x`, `r`; the run stays.
3. A count and repeat: `3x`, then `.`.
4. Insert-mode Enter, or Cmd/Ctrl+Enter where the site sends with it, still sends (or makes a
   new line where Enter does), with VimText Active.
5. From Insert, one Esc, then `:q`: the editor keeps its text and the page takes focus back. A
   second Esc in Normal reaches the page (DESIGN.md "Key Policy" row 5), and Gmail closes its
   compose window on it.
6. Keys back to back: `G A`, Enter, a word, Esc with no pause between them. The word is kept.
   Reading the page between those keys hides a loss there (#68).
7. In Normal, the character under the Cursor shows inverted (a dark block, the character light),
   and a Normal move opens none of the site's selection toolbars (ADR 0009, #76). Zoom a
   screenshot on it: an opaque box hiding the character is a finding.

**Which editor, per site** (record the library if the DOM shows it):

- **Stack Overflow**: the answer editor in rich mode (Stacks Editor, ProseMirror).
- **Reddit**: the rich-text comment composer on new reddit. Claude in Chrome could not
  open reddit.com in 2026-11: the user drives it, or it is skipped and recorded so.
- **Gmail**: the compose body. Do not send; discard the draft.
- **Slack**: the message box; a DM to yourself. Enter sends.
- **GitHub**: an issue or PR comment's rich editor if one is offered; otherwise the
  `<textarea>`, and say so.
- **Notion**: a scratch page with several blocks, one of them several lines (Shift+Enter),
  moved to trash afterwards. Notion holds every block, each marked `contenteditable`, inside one
  editable page root that keeps focus; each block is its own Field (#69, an accepted M4
  limitation): check `j`/`k` stay inside a block and nothing is lost crossing blocks with the
  mouse, and that `o`, `O`, a linewise `p` and `u` of `J` inside the several-line block land
  (#70), on its last line too.

Record one comment per site on the gate ticket: site, editor library, each step's outcome, and
the issue filed for any finding. A finding the site's markup causes adds that markup to
`tests/fixtures/site-shapes.html` and its steps to `tests/e2e/site-shapes.spec.ts`, so the gate
catches it from then on.

**A blocking finding** is fixed on its own branch with a regression test, passes `/code-review`
against `main`, and merges with `Closes #<n>`. The pass then re-checks it live on the rebuilt
extension, reloaded in `chrome://extensions`.

**An agent driving the pass** (Claude in Chrome), beside the rules above: a write settles
asynchronously (ADR 0008), so read the page half a second after a step. What the tool cannot
do: Ctrl-r reaches Chrome as a reload, never the page, so the owner checks redo by hand;
reddit.com is blocked; `app.notion.com` needs the owner to allow it in the extension first; a
send or post (Slack's Enter, Gmail's and GitHub's Cmd+Enter) waits for the owner's go-ahead
in chat. A confirm dialog stops the tool: discard Stack Overflow's draft with `window.confirm`
stubbed. Cmd+B from the tool makes a bold run on Gmail only: on Stack Overflow and Slack
click the editor's Bold button while in Insert. Gmail's compose URL
(`#inbox?compose=new`) on a full page load needs more than four seconds before the body
exists. A notice (`/zzz`'s "No match found") stays in the Status Line for some seconds
before `--NORMAL--` returns. On Notion, Enter in Insert makes a new block and the Status
Line hides, since the caret is in another Field: that is step 4 passing.

**No one at a signed-in browser** (the owner remote, #56): `npm run build`, then
`npm run dogfood:demos [prosemirror|lexical|slate|quill]` runs these steps on the libraries'
public demos (prosemirror.net, playground.lexical.dev, slatejs.org, quilljs.com) through the
built extension in Playwright's Chromium (`tools/dogfood-demos.mjs`). It stands in for the
libraries, not the sites: the sign-ins, the send keys and Stack Overflow (behind a Cloudflare
challenge) stay with a person, and the comment on the gate ticket says which were reached.
To tell a regression from an old gap, build `main` in a temporary worktree and run it there too.

### Monaco code editors

Added with the Monaco Field (#122, ADR 0010). The same blocker rule. Signed out is enough, and
nothing is run or submitted: never press the site's Run or Submit.

**Switch the setting on**: the options page, "Vim in Monaco code editors". Leave the site's own
Vim mode off (LeetCode: Settings, Code Editor, Key binding; CodeBite: the editor's settings).

**On each site,** in the code editor, on the code the site starts with, with the console open.
After each step the editor's whole text is what Vim gives for the text before it
(`monaco.editor.getEditors()` in the console reads it: Monaco draws only the lines in view):

1. Click into the code; Esc shows `--NORMAL--` under the editor and Monaco's block cursor.
2. `gg dd`, `u`, Ctrl-r, `u`.
3. `gg yy p`, `u`.
4. `gg ^ cw`, a word, Esc; one `u` takes the whole change back.
5. `gg 0 x`, then `.`; `u` twice.
6. Visual: `gg 0 v l l d`, `u`; `gg V j d`, `u`.
7. `:%s/e/E/g`, `u`. The engine's notice stays on the Status Line for about 15 seconds.
8. Insert: `gg A`, a space, `zq(`: the site closes the bracket, `zq()`. Esc, and one `u`
   takes the typing back. A bracket Monaco leaves open is its own choice (DESIGN.md
   "Accepted limitations").
9. `gg A`, a space, the first letters of a word the code holds: where a suggestion popup
   opens, one Esc closes it and shows `--NORMAL--`. `u`.
10. Switch the language with the site's picker and click back into the code: `gg dd` and `u`
    work on the new code, and a second `u` changes nothing (no way back into the old language).
11. Change something (`x`), press the site's reset button and confirm, click back into the
    code: the starting code is back, and `gg dd`, `u` work on it.
12. `i`: the cursor is the site's own again, and Esc brings the block back.
13. No console errors from VimText.

**Then, with the setting switched off** (reload the tab): Esc shows no Status Line and `dd`
types `dd` into the code, as 0.4.3.

**Which page, per site** (re-check when a site redesigns):

- **LeetCode**: any problem, e.g. `leetcode.com/problems/stone-removal-game`. Input through
  `textarea.inputarea`. Signed out, typing opened no suggestion popup in 2026-11: step 9 is
  then the Esc alone. The reset button is the arrow turning left above the editor.
- **CodeBite**: any problem, e.g. `code-bite.com/problems/reverse-linked-list`. Monaco's
  EditContext input. The reset button (코드 초기화) asks to confirm.
- **NeetCode**, with the setting on: `neetcode.io/problems/climbing-stairs/question` has no
  `window.monaco`, so VimText stands down: no Status Line, `dd` typed as text.

**No one at the browser**: `npm run build`, then
`npm run dogfood:monaco -- <leetcode|code-bite|neetcode> [--off] [--out <dir>]`
(`tools/dogfood-monaco.mjs`) walks steps 1 to 11, or the stand-down check with `--off` and on
NeetCode, through the built extension in Playwright's Chromium with a fresh profile, compares
the whole text after each step and exits non-zero on a difference. `--out` keeps a video and
the step log. LeetCode serves a Cloudflare challenge to headless Chromium, so the tool opens a
window for it and for CodeBite; when a site redesigns, its picker and reset button are the
`SITES` entry at the top of the tool. Step 12 and a signed-in editor (its suggestions, the
site's own Vim mode switched on by mistake) stay with a person.

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
