# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, as in **Blocking** below). Without sub-issues, put `Part of #<parent>` at the top of the child body.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`
- **Verify a "red on `main`" claim in a brief**: `npm run red-on-main -- <test files>` (`tools/red-on-main.mjs`; its header says how it swaps the source and why never through `git stash`). It runs the tree's tests against `main`'s `src` and `popup`, committed fix or not, and exits 0 only when every file is red there.
- **A flake in a brief**: reproduce it with `npm run flake -- <specs>` (`tools/flake.mjs`; rounds with no retry, a trace kept for every failure, the load average per round, `--stress K` for CPU load it stops itself), and put in the brief, for each failure seen, its failing step and message, the trace's path, and the `machine` line the failure prints (browser launch time and load average). #79's triage recorded a Slate content mismatch by its message alone; it never came back in 4,200 runs, and #84 has nothing to start from. A brief's "N rounds in a row with `--retries=0`" is that command with `--rounds N`.
- **A probe's "nothing happened" in a brief**: a probe that reports a step doing nothing (a key that deleted nothing, a click that resumed nothing) runs a control beside it, the same step where it is known to work, and compares the whole text, before the result goes in a brief. #90's triage clicked a contenteditable mid-Field, pressed `x`, compared the first line only and recorded "a click may not resume it" as unsettled; with a control it was the click's place, and the implementer spent a `red-on-main` run on a bug that was not there.
- **A browser fact in a brief**: a ticket or spec that says how Chromium behaves (what an API returns, how a style renders) marks it _unprobed_ and lists it under acceptance as a `tests/unit/chromium-facts.test.ts` pin (CODING_STANDARDS rule 12), so the implementer probes it before building on it. #76's brief stated two, a textarea selection's `toString()` and `mix-blend-mode: difference` inverting the character; both were wrong, the second found only on the live gate.
- **Resolve earlier issues from a ticket**: a spec or ticket that implements decisions recorded on other issues lists `Closes #<n>` for each in its body, and the landing commit or PR carries the same lines, so the merge to `main` closes them. An issue left open after its work shipped costs a triage pass (#7, #8, #9 after M2 part 1). Under `/implement-spec`, each ticket's merge into the integration branch carries `Closes #<ticket>` (and the `Closes` lines of anything the ticket fixed), so the landing on `main` closes every ticket without a hand-written list (#41: #52–#55 and #57 closed only because the landing merge listed them).

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`.
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (see **Make an issue a sub-issue of a parent**). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
