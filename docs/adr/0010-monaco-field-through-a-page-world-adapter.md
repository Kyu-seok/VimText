---
status: proposed
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
