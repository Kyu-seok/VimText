---
status: accepted
---

# A Monaco code editor is a Field through one page-world adapter; contenteditable editors stay on the DOM

Decided in the grill of 2026-11-28 (#113); proposed until the spike it names reports. Narrows two rejections for Monaco alone: ADR 0007's of "per-editor adapters" and ADR 0008's of "reading editor models from an injected page-world script". A Monaco code editor becomes a third kind of Field, the Monaco Field. VimText's engine runs it as it runs every Field; what differs is where the text is read and written: a small script VimText declares for the page's own world reads and writes the editor's model and selection through `window.monaco`, at the request of VimText's content script, which accepts only text and a selection back. The feature ships off, behind one setting. With the setting off, or where `window.monaco` is absent, Monaco's input is not a Field, as #111 left it.

Why: Monaco keeps its code in its own model and draws only the lines in view, so the DOM holds no projection of the text for the isolated world to read. The element Monaco focuses holds a window of the text and reads any change to it as typing, which is how VimText corrupted code on leetcode and neetcode (#111). The contenteditable editors differ in kind: their text is in the DOM, the synthetic `beforeinput` path works on them, and both rejections still hold there.

## Considered options

- **Stay stood down** (0.4.3): every site examined (leetcode, neetcode, code-bite) has its own Vim setting, so Vim keys are two clicks away. What it lacks is the person's vimrc, Plugins and one Vim across Sites. This remains the fallback if the spike shows the cost is too high.
- **Inject a Monaco Vim library into the page**: a second engine with its own mappings and status bar, no Plugins, against ADR 0001.
- **No page API: synthetic keys and paste from the isolated world**: a select-all and paste replaced the model once on neetcode, from Insert only; nothing reads the full text back. A Field that cannot read its own text is #111 again.
- **Find Monaco inside a site's bundle where `window.monaco` is absent** (neetcode): worked once through the webpack chunk global, by searching 822 module factories for a method name; the names change with each build of the site.
- **Inject the page-world script on demand** (`scripting.executeScript`): needs host permissions, which can add an install warning and disable the extension for current users until they accept. A script tag of a web-accessible file exposes VimText's files to every page.

## Consequences

- A few lines of VimText run in every page's own world, setting on or off, where the page can see and interfere with them. The content script treats what comes back as untrusted: text and a selection, nothing else.
- In Insert, keys go to Monaco untouched, so its bracket closing, indenting and suggestions work; `.` repeats what Vim saw of an insert, not what Monaco added. One Esc closes a suggestion popup and goes to Normal.
- Normal shows as Monaco's own block cursor and Visual as Monaco's selection: VimText changes one option on the site's editor and restores it on Insert and when the Session ends. ADR 0009's drawn Cursor is for contenteditable Fields only.
- A Vim command acts on the primary cursor and drops Monaco's other cursors.
- Every command syncs the model's whole text; above a size limit set by measurement VimText stands down on that editor.
- One Field per editor instance. A model swapped under it (a language change) clears its undo history and marks.
- A site's own Vim mode is not detected: with both on, both act on each key. The setting's text says to turn one off.
- Only the writable main code editor is a Monaco Field. Monaco's find and rename inputs stay textarea Fields.
- The fixture for its tests loads the real Monaco package; #111's could imitate the markup because it tested a refusal.
- The spike must show, on leetcode and code-bite from a real content script: the text read, one edit written, the selection read and set, the cursor style switched, and an update that adds the page-world script installing with no new warning.

## What the spike showed (2026-11-28, #113)

Signed out on leetcode and code-bite, every answer through the built extension. It held on both sites unless a line says otherwise. Still proposed: the owner decides on this report.

- The round trip from the content script to the page world and back is synchronous, so a Monaco Field reads its text synchronously. Reading 2.8 MB took about 4 ms.
- An edit through `editor.executeEdits` lands byte-exact, with no indenting or bracket closing, and in Monaco's undo stack. One undo step per Vim change needs `editor.pushUndoStop()` before and after it.
- The selection reads and sets as offsets; the view follows only on `revealPosition`. `executeEdits` keeps Monaco's other cursors, so dropping them takes a `setSelection` after each command.
- The cursor style switches with `updateOptions` and the original reads back through `getOption`. Neither site reset it.
- A capture-phase `keydown` listener in the content script stops a key before Monaco acts on it, on `textarea.inputarea` and on the EditContext input alike.
- A suggestion popup shows in the DOM as `.suggest-widget.visible`; with Esc stopped it stays open until the page-world side hides it.
- The manifest with the page-world script reports the same install warnings as 0.4.3's (`chrome.management.getPermissionWarningsByManifest`, Chromium 158). A real packed update was not tried.

Three consequences above change with it:

- Neither site swaps the model on a language change: leetcode flushes it and code-bite replaces its whole range. Undo history and marks are cleared on a flush or a language change, not on a swapped model.
- "The writable main code editor" needs a rule: leetcode has a second writable editor of one plaintext line. The Field is the instance that holds text focus.
- Whole-text reads are cheap and whole-text writes are not (about 100 ms at 50k lines), so a write sends the mirror's changes as edits. No size limit came out of the bridge; the engine's cost on a large mirror was not measured.

And one reason weakens: the same check reported no new warning for `scripting` with `host_permissions: <all_urls>` either. The declared script remains the choice because it needs neither.

Riskiest piece: Insert pass-through. Monaco's own edits (a closed bracket, an accepted suggestion, a site rewrite) must reach the mirror without the engine's history and Monaco's undo stack disagreeing.

## Accepted (2026-11-28, #116)

The owner decided to build on the spike's report (spec #115). The tracer (#116) is the route above end to end, on a fixture that loads the real Monaco package: the setting, the declared page-world script, the Monaco Field resolved by `resolveField`, and writes as the mirror's changes through `executeEdits` between undo stops. The install-warning check is now a test (`tests/e2e/install-warning.spec.ts`): Chromium reports the same warnings for the manifest with the page-world script as without it. A real packed update is still untried.

## Built without change notifications (2026-11-28, #120)

Spec #115 had the page-world script start and stop change notifications, and Monaco's edits in Insert reach the mirror through them. The build has none: the page world answers requests and sends nothing unasked. What Monaco wrote in Insert (typing, a closed bracket, an indent, an accepted suggestion, its own undo) reaches the mirror when the next key VimText takes reads the editor's text, Esc at the latest, as one change of the Insert's undo step; a change the page makes in Normal is read at the next key the same way. Why: a push was not needed for one undo step per Insert, which the read at the next key gives, and it would have told of each change while Monaco was still making it, before its caret moved (docs/engine-seams.md, "Monaco: Insert typing"; DESIGN.md, "Ownership of text, by Mode"). Until that key the mirror is behind the editor.
