# VimText 0.3.0 — release notes and announcements

Every text that goes out with 0.3.0, drafted before the store upload and posted
by a human after the store's approval (DESIGN.md, M3 part 3). Each draft is in
its own fenced block so it can be copied whole.

Every draft carries the store page's URL, which goes live when the review
passes; nothing in a draft is a placeholder. The release notes (section 1)
say instead that the README links the store page, since the tag message
was written before the store assigned the URL.

The release notes are the annotated tag's message, verbatim
(`docs/release.md`): first line the title, plain text, no Markdown. The other
drafts use the markup of the site they are posted on (Hacker News and the tag
message: plain text; Reddit, Stack Exchange and GitHub: Markdown).

Rules every draft follows: it points at the store page and at the repository,
says Chrome only, says what VimText does and does not do with the accepted
limitations named rather than hidden, names no competing extension, and uses
the terms of `GLOSSARY.md`. None of it contradicts `DESIGN.md`, `PRIVACY.md` or
`docs/store/listing.md`.

## 1. Release notes (the `v0.3.0` tag message and the GitHub Release body)

```text
VimText 0.3.0: on the Chrome Web Store, with clipboard registers, Session State across tabs, and the surround and targets Plugins

VimText gives Vim's modal editing to the text fields of ordinary web pages
(textarea and single-line text inputs), editing the page's own field in
place: no native host, no replacement editor. Chrome only.

Install: from the Chrome Web Store once its review passes; the README links the store page.
Source, issues, design and the accepted limitations: https://github.com/Kyu-seok/VimText

0.3.0 is the first version on the Chrome Web Store. It closes M3. What is
new since 0.2.0:

Clipboard registers
- "+ is the system clipboard: "+p reads it; "+y, "+d and "+c write it. "*
  is an alias of "+. The unnamed register never touches the clipboard.
- The clipboard is read only for a "+ or "* paste and written only when a
  yank, delete or change stores text into "+ or "*. A denied read shows a
  message on the Status Line and leaves the text alone. A plain http://
  page has no clipboard API, so every "+ and "* command beeps there, with
  a message.

Session State across tabs
- Registers (the macros they hold included), search and command history
  and the last f/t search are shared by every field in every tab for as
  long as the browser runs. They live in Chrome's session storage and are
  gone when the browser closes.
- Two tabs changing a register at the same moment: the last write wins;
  nothing is merged.
- Marks, undo history and the jump list stay with the field they belong to.

vimrc
- The options page lists each failing line of a saved vimrc, with the
  engine's message, under the text box. A clean vimrc lists nothing.
- The saved vimrc is the whole truth about your mappings. Every Activation
  clears the user mappings and runs it again, so a mapping you delete is
  gone at the next Activation in every tab instead of lingering until a
  restart.

Plugins (off by default; switched on in the options page, effective at the
next Activation in every tab)
- surround (modelled on vim-surround): ys{motion}{char}, yss{char},
  cs{old}{new}, ds{old} and Visual S{char}; the four bracket pairs with
  the aliases b r B a (the opening character adds inner spaces, the closing
  one does not) and the three quotes; any other character wraps literally.
  . repeats ys, cs and ds with the same characters. Macros record and
  replay them.
- targets (modelled on targets.vim): i( a( i" a" and friends Seek the next
  pair or quote when the cursor is not inside one; the n and l prefixes
  (cin(, dil", vin(); the argument objects ia and aa.
- A vimrc mapping on a key a Plugin also binds wins, as your vimrc beats a
  plugin's default maps in Vim.
- Not in this version: surround's tag and function targets (ysiw<div>,
  cst, dst), yS ySS cS gS and Insert-mode Ctrl-s; targets' separator
  objects, I/A, any-block ib and any-quote iq. Known differences from the
  upstream plugins: a key VimText is holding while it waits for the rest of
  a Plugin sequence (the d of ds) does not show on the Status Line until
  the sequence resolves; Visual S is not .-repeatable; targets ranks its
  Seek candidates as if every line were on screen, so a next object below
  always beats a last object above; a pair whose brackets end and start
  lines of their own is charwise (ci{ leaves {}). The full list is under
  "Accepted limitations" in DESIGN.md.

Release
- The zip attached to this Release is what the store received, built from
  this tagged commit by the release workflow.
- The privacy policy ships with this version: PRIVACY.md in the repository,
  linked from the store page. In short: no analytics, no network requests,
  no remote code. Settings (Site Policies, the vimrc, the Plugin toggles)
  are carried by Chrome Sync when you have it on and otherwise stay on
  this device. The clipboard is touched only by "+ and "* commands.
  Registers and history are Session State in session storage, gone when
  the browser closes. The content script runs on every http and https page
  and frame, because nothing else could hear the Esc that Activates a
  field, but it reads only the field you Activated. A change to the policy
  ships with a new version and is noted in that version's release notes.
- The README describes a public install: Install leads with the store
  link, load-unpacked lives under Develop.

Still true in 0.3.0
- Chrome only. Firefox is untested and not submitted.
- textarea and the text, search, url, email and tel inputs, in the top
  page and in embedded frames, on plain pages and on pages whose framework
  rewrites the value (React controlled inputs, masks). contenteditable
  editors (Gmail, Slack, Notion, Reddit's rich-text composer) are the next
  milestone; canvas editors such as Google Docs are out of scope; password
  fields never.
- A field starts in Insert mode and is the page's own until you press Esc
  or Ctrl+[ on it. In Insert mode IME, autocomplete and the site's own
  handlers work as before; only Esc, Ctrl+[, Ctrl-o, Ctrl-r, Ctrl-u and
  Ctrl-w are Vim's there.
- No hlsearch highlighting (n and N work). Scroll commands (Ctrl-d/u/f/b,
  zz zt zb) approximate. Display-line motions approximate on unusual fonts.
  Visual block highlights only the primary range.
- A mapping whose prefix is itself a bound key (nnoremap <Space>x dd while
  <Space> is l) never fires: the engine takes the full match at once rather
  than waiting like Vim's timeoutlen. Map from an unbound prefix such as \.

Bugs and questions: https://github.com/Kyu-seok/VimText/issues
```

## 2. Show HN

Title (80 characters or fewer, no Markdown in the text):

```text
Show HN: VimText – Vim modal editing inside the browser's own text fields (Chrome)
```

Text:

```text
VimText is a Chrome extension that gives Vim's modal editing to the text fields of ordinary web pages. It edits the page's own textarea or input in place: no native host to install, no editor widget replacing the field.

Store: https://chromewebstore.google.com/detail/vimtext/egfolppakllammjdjnpbajpioigchbkp
Source (MIT): https://github.com/Kyu-seok/VimText

How it behaves: every field starts in Insert mode and is the page's own, so IME, autocomplete and the site's handlers work as before. Press Esc (or Ctrl+[) in a focused field and that field is under Vim until it leaves the page, with a small Status Line at its edge for the mode, pending keys, the : / ? command line and messages. A Site Policy can make a site start in Normal mode, or turn VimText off there. Tab, Cmd/Ctrl shortcuts the engine doesn't bind, a second Esc in Normal and Enter in a single-line input all reach the page, so the site stays usable.

The engine is the Vim implementation behind CodeMirror (@replit/codemirror-vim), run on a hidden mirror of the field. That is why motions, operators, text objects, counts, registers, marks, macros, Visual block, ".", search and ex commands (:s, :g, :sort, :map, :set) work; VimText is the bridge between that engine and the page: key routing, syncing the field and the mirror, and keeping the page's and Vim's undo from diverging. The baseline for "correct" is Vim's own :help. Two opt-in Plugins, off by default: surround (ys/cs/ds/Visual S) and targets (seeking text objects, the n/l prefixes, argument objects).

0.3.0 adds clipboard registers ("+ and its alias "*, touched only by "+/"* commands), registers and history shared across tabs for the life of the browser session, and a vimrc box whose failing lines are listed in the options page.

What it does not do: only Chrome (Firefox untested, not submitted). Only textarea and single-line text inputs; contenteditable editors (Gmail, Slack, Notion, Reddit's rich-text composer) are the next milestone, Google Docs is out of scope, password fields never. No hlsearch highlighting. Scroll commands approximate. One engine quirk: a mapping whose prefix is itself a bound key never fires (the engine takes the full match at once, no timeoutlen). Every known deviation is listed under "Accepted limitations" in DESIGN.md in the repo.

Privacy: no analytics, no network requests, no remote code. Settings travel with Chrome Sync if you have it on and otherwise stay on the device. The content script runs on every http/https page (nothing else could hear the Esc that Activates a field) but reads only the field you Activated. The policy is PRIVACY.md in the repo.

I wrote this because I kept reaching for dd in comment boxes. Happy to answer questions about the bridge, the undo story on React-controlled inputs, or why the Plugins are engine commands rather than a fork.
```

## 3. r/vim

Title:

```text
VimText: Vim modal editing in the browser's own text fields, as a Chrome extension (baseline is :help; surround and targets as opt-in Plugins)
```

Body:

```text
I wrote a Chrome extension that puts Vim's modal editing on the text fields of ordinary web pages: comment boxes, issue forms, search inputs. It edits the page's own textarea or input in place. No native host, no Neovim to install, no editor replacing the field.

Store: https://chromewebstore.google.com/detail/vimtext/egfolppakllammjdjnpbajpioigchbkp
Source (MIT): https://github.com/Kyu-seok/VimText

**How it feels**

- A field starts in Insert mode and is the page's own. Press `Esc` or `Ctrl+[` and that field is under Vim until it leaves the page. A Site Policy can make a site start in Normal mode, or turn VimText off there.
- A Status Line at the edge of the field shows the mode, pending keys, `recording @q`, the `:` `/` `?` command line and messages such as `E486`.
- The engine is the Vim implementation behind CodeMirror (`@replit/codemirror-vim`), so what you expect is there: motions, operators, text objects, counts, registers, marks, macros, Visual charwise/linewise/block, `.`, search and ex commands (`:s`, `:g`, `:sort`, `:map`, `:set`). `u` and `Ctrl-r` are one history; the browser's own undo shortcuts are swallowed outside Insert so the two never diverge.
- A vimrc box in the options page takes ex commands (`nnoremap Y y$`, `set ignorecase`, ...) and runs them on every Activation; a failing line is listed under the box with the engine's message.
- `"+` is the system clipboard and `"*` is its alias. Registers, macros, search and command history are shared across tabs for the life of the browser session.
- Plugins, off by default: **surround** (`ys` `yss` `cs` `ds`, Visual `S`, `.` repeats) and **targets** (`ci(` from outside the parentheses seeks the next pair, `i"` from anywhere on the line, `cin(` `dil"`, the argument objects `ia`/`aa`). A vimrc mapping on a key a Plugin also binds wins, as in Vim.

The rule for "is it correct" is Vim's `:help`. Plugin behaviour is never part of that baseline, and the upstream plugin's documentation is the oracle for it.

**What it does not do**

- Chrome only. Firefox is untested and not submitted.
- textarea and single-line text inputs (text, search, url, email, tel) only, in the top page and in frames, including React-controlled inputs and masks. contenteditable editors (Gmail, Slack, Notion, Reddit's rich-text composer) are the next milestone; Google Docs is out of scope; password fields never.
- No `hlsearch` highlighting (`n`/`N` work). Scroll commands approximate. Visual block highlights only the primary range.
- Engine quirk: a mapping whose prefix is itself a bound key (`nnoremap <Space>x dd` while `<Space>` is `l`) never fires, because the engine takes the full match at once instead of waiting like `timeoutlen`. Map from an unbound prefix such as `\`.
- surround v1 has no tag or function targets (`ysiw<div>`, `cst`, `dst`); targets v1 has no separator objects, `I`/`A`, any-block `ib` or any-quote `iq`. Visual `S` is not `.`-repeatable. The key VimText holds while it waits for the rest of a Plugin sequence (the `d` of `ds`) is not shown on the Status Line until the sequence resolves.

The full list is under "Accepted limitations" in DESIGN.md in the repo. If something behaves differently from Vim and is not on that list, that is a bug: https://github.com/Kyu-seok/VimText/issues

Privacy: no analytics, no network requests, no remote code. Settings travel with Chrome Sync if you have it on and otherwise stay on the device. The content script runs on every http/https page (nothing else could hear the Esc that Activates a field) but reads only the field you Activated. PRIVACY.md in the repo has the full text.
```

## 4. r/chrome_extensions

Title:

```text
VimText (MV3, open source): Vim modal editing on the page's own text fields, inert until you press Esc
```

Body:

```text
I published VimText, a Chrome extension that gives Vim's modal editing to the text fields of ordinary web pages. It edits the page's own textarea or input in place, with no native messaging host and no replacement editor widget.

Store: https://chromewebstore.google.com/detail/vimtext/egfolppakllammjdjnpbajpioigchbkp
Source (MIT): https://github.com/Kyu-seok/VimText

**What it does**

- Every field starts in Insert mode and behaves natively; VimText shows nothing. Press `Esc` or `Ctrl+[` in a focused field to Activate Vim on it. A Site Policy (from the popup or the options page) can make a site start in Normal mode or turn VimText off there.
- In every other mode the engine owns the text and writes it back to the field with the native value setter plus a synthetic `input` event, so React-controlled inputs and masks keep the edits. When the page rewrites the value, the page wins and VimText follows.
- A fixed set of keys always reaches the page: `Tab`, `Cmd`/`Ctrl` shortcuts the engine does not bind, a second `Esc` in Normal (so a site's modal still closes), `Enter` on a single-line input in plain Normal (so the form still submits).
- A Status Line in a shadow root at the edge of the field shows the mode, pending keys and the command line. No page-level bar.
- Options page: a vimrc box (ex commands, failing lines listed under it), two opt-in Plugins (surround, targets), the Site Policy table.

**Permissions, and why**

- `storage`: Site Policies, the vimrc and the Plugin toggles in `storage.sync` (carried by Chrome Sync when you have it on, otherwise on the device); registers and history in `storage.session`, gone when the browser closes.
- `clipboardRead` / `clipboardWrite`: for Vim's `"+` and `"*` registers only. The clipboard is read only on a `"+`/`"*` paste and written only when a yank, delete or change stores text into `"+`/`"*`; the unnamed register never touches it.
- Content script on `http://*/*` and `https://*/*`, all frames. This is what Chrome shows as "read and change all your data on all websites". `activeTab` cannot work here: an extension that is inert until you press Esc inside a field needs something listening for that Esc before you have clicked anything. The script reads only the field you Activated.
- No `tabs`, no `scripting`, no remote code, no network requests, no analytics. The service worker does one thing: grant content scripts access to session storage. The policy is PRIVACY.md in the repo and is linked from the store page.

**What it does not do**

- Chrome only. Firefox is untested and not submitted.
- textarea and single-line text inputs (text, search, url, email, tel) only. contenteditable editors (Gmail, Slack, Notion, Reddit's rich-text composer) are the next milestone; Google Docs is out of scope; password fields never.
- No `hlsearch` highlighting. Scroll commands approximate. Fields that reformat in a `setTimeout` are reconciled on the next keystroke. Frames the page creates as `about:blank`, `srcdoc` or `blob:` are not covered.
- The engine takes the longest full match at once, so a user mapping whose prefix is itself a bound key never fires (no `timeoutlen`).

The full list is under "Accepted limitations" in DESIGN.md. Bugs: https://github.com/Kyu-seok/VimText/issues

Stack, for the curious: TypeScript, esbuild, MV3, the Vim engine behind CodeMirror (`@replit/codemirror-vim`) running on a hidden mirror of the field; Vitest in real Chromium for the sync layer and Playwright driving the unpacked extension end to end. One `npm run check` is the gate and the tag-driven GitHub Release builds the zip the store receives.
```

## 5. Stack Exchange answers

Each answer is posted on the question it names and carries the affiliation
sentence. One question is on Stack Overflow proper; two are on Unix & Linux
Stack Exchange, the same network, and were the only other open questions that
ask for this (existence and titles verified through the Stack Exchange API on
2026-11-09). Answers on an old question are fine when they add a current
option; each one says plainly what it does not do, so it is not a bare
advertisement.

### 5a. Stack Overflow: "Vim binding in browsers"

Question: https://stackoverflow.com/questions/29241975/vim-binding-in-browsers
(asks for Esc then `dd` inside Chrome's own text fields, as opposed to the
navigation extensions.)

```text
Disclosure: I wrote the extension this answer recommends.

The navigation extensions you tried are for moving around the page; they do not give you a Normal mode inside a text field. What you describe (press Esc in the text area you are typing in, then `dd`) is what [VimText](https://chromewebstore.google.com/detail/vimtext/egfolppakllammjdjnpbajpioigchbkp) does. It is a Chrome extension (Chrome only; Firefox is untested) that edits the page's own textarea or input in place: no native host and no editor widget replacing the field. Source is on GitHub: https://github.com/Kyu-seok/VimText

How it works: every field starts in Insert mode and behaves natively. Press `Esc` or `Ctrl+[` and that field is under Vim until it leaves the page, with a small Status Line at its edge for the mode, pending keys and the `:` `/` `?` command line. The engine is the Vim implementation behind CodeMirror, so motions, operators, text objects, counts, registers, marks, macros, Visual block, `.`, `u`/`Ctrl-r` and ex commands (`:s`, `:g`, `:sort`, `:map`, `:set`) work, and a vimrc box in the options page takes your mappings. A Site Policy can make a site start in Normal mode or turn the extension off there. `Tab`, `Cmd`/`Ctrl` shortcuts, a second `Esc` and `Enter` in a single-line input still reach the page.

Limits worth knowing before you install: it covers `<textarea>` and single-line text inputs only, not contenteditable editors (Gmail, Slack, Notion), and not Google Docs. There is no `hlsearch` highlighting, scroll commands are approximate, and a mapping whose prefix is itself a bound key never fires (the engine takes the full match at once, there is no `timeoutlen`). The full list is under "Accepted limitations" in the repo's DESIGN.md.

Privacy: no analytics, no network requests, no remote code; the content script runs on every page but reads only the field you Activated with Esc. The policy is PRIVACY.md in the repo.
```

### 5b. Unix & Linux Stack Exchange: "Vim interface on web browser input fields?"

Question: https://unix.stackexchange.com/questions/36257/vim-interface-on-web-browser-input-fields
(asks for a browser plugin that gives input boxes the keyboard interface of
Vim, on Chrome.)

```text
Disclosure: I wrote the extension this answer recommends.

A current option for Chrome: [VimText](https://chromewebstore.google.com/detail/vimtext/egfolppakllammjdjnpbajpioigchbkp) (source: https://github.com/Kyu-seok/VimText, MIT). It gives Vim's modal editing to the page's own text fields, in place. There is nothing to run outside the browser: no native host, no editor server, no Neovim install, and the field is not replaced by an editor widget. Chrome only; Firefox is untested and not submitted.

Each field starts in Insert mode and is the page's own, so IME, autocomplete and the site's handlers keep working. Press `Esc` (or `Ctrl+[`) in a focused field and it is under Vim until it leaves the page; a Status Line at the edge of the field shows the mode, pending keys and the `:` `/` `?` command line. The engine is the one behind CodeMirror's Vim mode, so motions, operators, text objects, counts, registers, marks, macros, Visual block, `.`, search and ex commands work, `"+` and `"*` are the system clipboard, and a vimrc box in the options page takes mappings and `set` options. A Site Policy can make a site start in Normal mode (closer to what you ask for) or turn the extension off there. Two opt-in Plugins, off by default, model surround and targets.

What it does not do: only `<textarea>` and single-line text inputs (text, search, url, email, tel), in the top page and in frames. contenteditable editors such as Gmail, Slack and Notion are not covered yet, Google Docs is out of scope, password fields never. No `hlsearch` highlighting; scroll commands are approximate; a user mapping whose prefix is itself a bound key never fires (the engine takes the full match at once, no `timeoutlen`). The repo's DESIGN.md lists every known deviation from Vim under "Accepted limitations".

Privacy: no analytics, no network requests, no remote code. Settings travel with Chrome Sync when it is on and otherwise stay on the device; the content script runs on every http/https page but reads only the field you Activated. The policy is PRIVACY.md in the repo.
```

### 5c. Unix & Linux Stack Exchange: "Is there a method for making Google Chrome open textareas in vim?"

Question: https://unix.stackexchange.com/questions/99466/is-there-a-method-for-making-google-chrome-open-textareas-in-vim
(asks for a Chrome replacement for an external-editor add-on, without running a
separate server.)

```text
Disclosure: I wrote the extension this answer recommends.

If what you miss is Vim's editing rather than your own Vim binary and plugins, there is now a way that needs no server and no native host: [VimText](https://chromewebstore.google.com/detail/vimtext/egfolppakllammjdjnpbajpioigchbkp), a Chrome extension (source: https://github.com/Kyu-seok/VimText, MIT). To be clear about what it is not: it does not open the textarea in your installed vim or gvim, and your `~/.vimrc` and plugins are not involved. It runs a Vim engine (the one behind CodeMirror's Vim mode) inside the browser and edits the page's own textarea in place.

What you get: press `Esc` or `Ctrl+[` in a focused textarea or single-line input and that field is under Vim until it leaves the page, with a Status Line at its edge for the mode, pending keys and the `:` `/` `?` command line. Motions, operators, text objects, counts, registers, marks, macros, Visual block, `.`, search and ex commands (`:s`, `:g`, `:sort`, `:map`, `:set`) work; `"+` and `"*` are the system clipboard; a vimrc box in the options page takes mappings and `set` options; surround and targets are available as opt-in Plugins. Until you press Esc the field is the page's own, so nothing changes on sites where you do not want it, and a Site Policy can turn it off or make a site start in Normal mode.

Limits: Chrome only (Firefox untested, not submitted). `<textarea>` and single-line text inputs only; contenteditable editors (Gmail, Slack, Notion) are not covered yet and Google Docs is out of scope. No `hlsearch` highlighting, approximate scroll commands, and a mapping whose prefix is itself a bound key never fires (the engine takes the full match at once, no `timeoutlen`). DESIGN.md in the repo lists every known deviation under "Accepted limitations".

Privacy: no analytics, no network requests, no remote code; the content script runs on every http/https page but reads only the field you Activated. The policy is PRIVACY.md in the repo.
```

## 6. GitHub Discussion (category: Announcements, on Kyu-seok/VimText)

Title:

```text
VimText 0.3.0 is on the Chrome Web Store
```

Body:

```text
VimText 0.3.0 is the first version you can install from the Chrome Web Store: https://chromewebstore.google.com/detail/vimtext/egfolppakllammjdjnpbajpioigchbkp

The release and the zip the store received are at https://github.com/Kyu-seok/VimText/releases/tag/v0.3.0; the release notes there are the full list of what changed since 0.2.0. In short, M3 is closed:

- **Clipboard registers.** `"+` is the system clipboard, `"*` its alias; read only on a `"+`/`"*` paste, written only when a yank, delete or change stores text into them. A denied read is a Status Line message, not an error.
- **Session State across tabs.** Registers (macros included), search and command history and the last `f`/`t` search are shared by every Field in every tab for the life of the browser session, in session storage. Last writer wins.
- **vimrc.** Failing lines are listed under the box in the options page; the saved vimrc is the whole truth about your mappings, re-run on every Activation, so a deleted mapping is gone everywhere at the next Activation.
- **Plugins**, off by default: surround (`ys` `yss` `cs` `ds`, Visual `S`, `.` repeats) and targets (Seek, the `n`/`l` prefixes, `ia`/`aa`). A vimrc mapping on a key a Plugin also binds wins.
- **Release.** A `package` script and a tag-driven GitHub Release build the zip; the privacy policy ([PRIVACY.md](https://github.com/Kyu-seok/VimText/blob/main/PRIVACY.md)) and the store listing texts live in this repo; the README describes a public install.

Chrome only (Firefox is untested and not submitted). textarea and single-line text inputs only; contenteditable editors (Gmail, Slack, Notion, Reddit's rich-text composer) are M4; Google Docs is out of scope; password fields never. Every known deviation from Vim, including the ones the Plugins have from their upstreams, is under [Accepted limitations in DESIGN.md](https://github.com/Kyu-seok/VimText/blob/main/DESIGN.md#accepted-limitations-m1m3). If something differs from `:help` and is not on that list, please open an issue: https://github.com/Kyu-seok/VimText/issues

Privacy, in one paragraph: no analytics, no network requests, no remote code. Settings (Site Policies, the vimrc, the Plugin toggles) travel with Chrome Sync when you have it on and otherwise stay on the device. The content script runs on every http/https page and frame, because nothing else could hear the Esc that Activates a Field, but reads only the Field you Activated. A change to the policy ships with a new version and is noted in that version's release notes.

Before the upload I wrote comments on GitHub, Hacker News, Stack Overflow and Reddit's Markdown editor with it in Normal, Insert and Visual, with `u` and `"+p`. Reports from other sites are welcome here or in Issues.
```
