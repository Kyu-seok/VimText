# VimText privacy policy

VimText is a Chrome extension that gives Vim's modal editing to the text fields
of ordinary web pages. It has no server and no account. Nothing you type leaves
your browser because of VimText. This page says exactly what the extension
stores, where, and what each permission in the install prompt is for. Terms in
bold are defined in [GLOSSARY.md](GLOSSARY.md).

## What VimText never does

- **No analytics.** VimText has no telemetry, no crash reporting, no usage
  counters, no identifiers.
- **No network requests.** The extension makes none: no `fetch`, no
  `XMLHttpRequest`, no WebSocket, no beacon. It cannot send anything anywhere.
- **No remote code.** Everything the extension runs ships inside the package
  you install from the Chrome Web Store; nothing is downloaded or evaluated at
  run time.
- **No reading of pages.** VimText does not read page text, form contents,
  cookies or history. Of the address it reads only the page's origin (scheme and
  host, such as `https://github.com`), to look up your **Site Policy** for that
  site. The one element it reads is the **Field** you **Activated** (below).

## What the content script does on every page

The install prompt says VimText can "read and change all your data on all
websites". That is Chrome's wording for the host match `http://*/*` and
`https://*/*` in the manifest, with `all_frames` set: the content script is
loaded on every http and https page and in every frame of it.

It is loaded everywhere because it has to be already listening when you press
`Esc`: a Field starts in Insert mode and behaves natively, VimText shows
nothing, and only the first `Esc` or `Ctrl+[` in a focused Field Activates Vim
on that Field (a **Site Policy** can instead Activate as soon as a Field is
focused, or turn VimText off on a site). Until then the script is inert on that
Field. Once a Field is Activated, VimText reads and writes that Field's text and
selection and nothing else on the page. It runs in frames because comment boxes
and editors are often embedded frames; a frame's Fields are governed by the
Site Policy of the page around it.

## What is stored, and where

VimText uses the `storage` permission for two kinds of data. Neither is sent to
VimText's author, who has no server to send it to.

**Settings**, in `chrome.storage.sync`: your Site Policies (which name the
sites you set a policy for, as origins such as `https://github.com`), the
global on/off switch, your vimrc text, and the **Plugin** toggles (surround,
targets). When you are signed in to Chrome with sync turned on, Chrome carries
these between your browsers under your Google account, on Chrome's terms. With
sync off they stay on the device. There is no other copy.

**Session State**, in `chrome.storage.session`: Vim's registers (the macros
and search patterns they hold included), the search and command-line history,
and the last `f`/`t` character search, shared by every Field in every tab so
`"ayy` in one tab can be `"ap` in another. Session storage lives in memory for
the life of the browser session and is gone when the browser closes. It is
never written to disk by VimText and never synced. Marks, undo history and the
jump list belong to one Field and are discarded with it.

## The clipboard

The `clipboardRead` and `clipboardWrite` permissions serve Vim's clipboard
register, `"+`, and its alias `"*`. The clipboard is read only when you paste
from that register (`"+p`, `"*P`, and the like) and written only when you store
text into it (a yank such as `"+yy`, or a delete or change that names the
register, such as `"+dd`). No other command touches the clipboard: the unnamed
register and every named register stay inside the browser, and `Cmd+V` in
Normal mode is passed through to the page untouched. What is read is
pasted into the Field under your cursor and nowhere else.

## Changes to this policy

A change to this policy ships with a new version of the extension and is noted
in that version's release notes on
[GitHub Releases](https://github.com/Kyu-seok/VimText/releases). The history of
this file is the history of the policy:
[PRIVACY.md on GitHub](https://github.com/Kyu-seok/VimText/blob/main/PRIVACY.md).

## Contact

Questions and reports: [GitHub Issues](https://github.com/Kyu-seok/VimText/issues).
