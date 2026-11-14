# VimText: Chrome Web Store listing

Every text typed into the Chrome Web Store developer dashboard, in the order
the dashboard asks for it, so that a resubmission diffs what changed (spec #27).
The four screenshots sit beside this file as the four PNGs in `docs/store/`;
the dashboard takes them at 1280×800. Two checks in `npm test` keep this file
honest: the Summary is the manifest's `description`, and every permission and
host match in `manifest.json` is justified below (`tests/node/summary.test.ts`,
`tests/node/permissions.test.ts`). Terms as in [GLOSSARY.md](../../GLOSSARY.md).

## Store listing

**Name:** VimText

**Store icon:** `icon-128.png` beside this file: 128×128, the 96×96 artwork centred in 16px of
transparent padding, as the store asks. `icon.svg` is its source, rendered by
`npm run screenshots`. The extension's own `icons/` come from the same drawing: `npm run icons`
(`tools/make-icons.mjs`) renders `icon.svg` at 128 and at 48 (without the `-- NORMAL --` text),
and `tools/icon16.svg`, the tile and block cursor without text, at 16. After an edit to
`icon.svg`, run both on macOS.

**Promo tiles:** `promo-small.png` (440×280, the small promo tile) and `promo-marquee.png`
(1400×560, the marquee promo tile) beside this file, opaque 24-bit PNGs as the store asks.
Their sources are `promo/small.html` and `promo/marquee.html`, rendered by
`npm run screenshots` on macOS (the text uses Menlo and the system sans-serif).

**Summary** (132 characters at most; this exact sentence is the manifest's `description`,
so Chrome and the store page show the same words):

> Vim modal editing for the text fields of ordinary web pages: edits the page's own field in place, no native host.

**Description:**

> VimText gives Vim's modal editing to the text fields of ordinary web pages:
> comment boxes, issue forms, wikis, search fields, rich-text editors. Focus a
> field, press Esc, and the field is in Normal mode: motions, operators, text
> objects, counts, registers, marks, macros, Visual charwise, linewise and
> block, the dot command, search, and ex commands such as :s, :g, :sort, :map
> and :set.
>
> What is different about VimText:
>
> It edits the page's own field in place. There is no replacement editor and
> no popup window; the text you edit is the text the page submits, and the
> page's own handlers keep working. Insert mode stays native, so IME input,
> autocomplete and the site's own shortcuts keep working.
>
> There is no native host to install. Install from the Web Store and go.
>
> Vim's :help is the oracle. The Baseline is what Vim does, as documented, and
> VimText reuses a complete Vim engine rather than reimplementing a subset of
> keys. Where it deviates, the limitation is written down in the repository.
>
> Inert until asked. A field starts in Insert mode and behaves natively; VimText
> shows nothing until you press Esc or Ctrl+[ in it. A Site Policy, set from the
> popup or the options page, can start a site's fields in Normal mode or turn
> VimText off there. The web stays usable in Normal mode: Tab, a second Esc,
> Enter on a single-line field and the Cmd/Ctrl shortcuts Vim does not use
> reach the page as before.
>
> A Status Line at the edge of the field shows the Mode, pending keys, macro
> recording, the command line and Vim's messages.
>
> The clipboard register "+ (and its alias "*) is the system clipboard; the
> unnamed register never touches it. Registers, macros and history are shared
> by every tab for the life of the browser session.
>
> A vimrc of ex commands (nnoremap, set, ...) runs on every field. Two opt-in
> Plugins, off by default, model vim-surround (ys, cs, ds, Visual S) and
> targets.vim (seeking text objects, the n/l prefixes, argument objects).
>
> Works on textarea and on text, search, url, email and tel inputs, in the top
> page and in embedded frames, on plain pages and on React-controlled inputs.
>
> Works on contenteditable editors too: the rich-text boxes of sites such as
> Gmail, Slack and Notion. VimText's edits go through the editor, so the
> editor's own model takes them. ProseMirror, Lexical, Slate and Quill are
> covered by tests against pinned builds of each. In these editors VimText edits
> the text and leaves the formatting to the editor: yank and put carry plain
> text (Cmd+V keeps the editor's rich paste), u restores the text but not always
> its formatting, and a mention chip or inline image counts as one character
> that u brings back only while VimText still holds it. VimText's edits are in
> the editor's own undo history too, so Cmd+Z in Insert mode can undo them.
> Notion makes each block its own field, so j and k stop at a block's edge.
> Display-line motions approximate on mixed fonts. Google Docs draws on a canvas
> and is out of scope.
>
> No analytics, no network requests, no remote code. Settings travel with
> Chrome Sync when you have it on. Open source, MIT:
> https://github.com/Kyu-seok/VimText

**Category:** Developer Tools

**Language:** English (the only listed language; no localised listings)

**Screenshots** (1280×800, the four PNGs beside this file):

1. Normal mode on a textarea styled as a comment form: the block cursor and
   the Status Line reading NORMAL.
2. A Visual selection on the same textarea, the Status Line reading VISUAL.
3. The command line open on the Status Line with an `:s` command typed.
4. The options page: the vimrc box, the Plugin toggles and the Site Policy table.

**Official URL / Homepage URL:** https://github.com/Kyu-seok/VimText

**Support URL:** https://github.com/Kyu-seok/VimText/issues

## Privacy practices

**Single purpose description:**

> VimText adds Vim's modal editing (Normal, Visual, Replace and Command-line
> modes, Vim's keys and ex commands) to the text fields of web pages, editing
> the page's own field in place. It does nothing else.

## Permission justifications

Why these permissions and not narrower ones is also recorded in
`docs/release.md` ("Permission choices").

**`storage`:**

> VimText keeps the user's settings (which sites it is enabled on and in which
> Start Mode, the user's vimrc text, and two Plugin toggles) in
> `chrome.storage.sync`, so they follow the user's Chrome Sync when it is on and
> otherwise stay on the device. It keeps Vim's registers, macros and command
> history in `chrome.storage.session`, so they are shared by every tab and gone
> when the browser closes. Nothing is stored anywhere else.

**`clipboardRead`:**

> Vim has a clipboard register, `"+` (VimText also accepts `"*` as its alias).
> `clipboardRead` is used only when the user pastes from that register (`"+p`),
> via `navigator.clipboard.readText()` on the page; what is read is pasted into
> the field under the cursor. No other command reads the clipboard.

**`clipboardWrite`:**

> `clipboardWrite` is used only when the user stores text into the clipboard
> register (`"+yy`, `"+dd`), via `navigator.clipboard.writeText()`. The unnamed
> register and every other Vim register never touch the clipboard.
>
> Both clipboard permissions are requested at install time rather than at the
> first `"+` because the user is typing in a page when the command happens:
> `chrome.permissions.request` is not available to a content script, so the
> prompt could only come from the popup or the options page, away from the
> field; a Vim command is a keystroke sequence, and a prompt in the middle of
> `"+p` would interrupt it and lose the key.

**Host permission `http://*/*` and `https://*/*`, with `all_frames`:**

> The content script must run on all http and https pages, in every frame,
> because VimText is inert until the user presses Esc in a focused text field:
> something has to be already listening for that key on every page the user
> might type on. `activeTab` cannot do this. It grants access only after the
> user clicks the extension's icon or presses its shortcut, so nothing would be
> listening for the Esc that Activates a Field, and the user would have to
> click the toolbar on every page and after every navigation before Vim worked.
> Frames are included because comment boxes and editors are often embedded
> frames (same-origin and cross-origin). On every page the script does nothing
> until a text field is focused and Esc is pressed; it reads and writes only
> that field. It does not read page content, cookies or history; of the URL it
> reads only the origin, to look up the user's Site Policy for the site.
> Users can turn VimText off for a site, or globally, from the popup.

**Remote code:** No, I am not using remote code. Everything runs from the
package; there is no `fetch`, no `eval`, no injected script tag.

## Data usage

**What user data do you plan to collect from users now or in the future?**
None of the listed categories: VimText does not collect user data. (No
personally identifiable information, health, financial or payment, authentication,
personal communications, location, web history, user activity, or website
content is collected.)

**Certifications** (all three checked):

- [x] I do not sell or transfer user data to third parties, outside of the
      approved use cases.
- [x] I do not use or transfer user data for purposes that are unrelated to my
      item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for
      lending purposes.

**Privacy policy URL:** https://github.com/Kyu-seok/VimText/blob/main/PRIVACY.md

## Distribution

**Visibility:** Public

**Regions:** All regions

## Notes for the reviewer

> VimText is inert until asked: it shows nothing on a page until a text field
> is focused and Esc is pressed. To see it work: open any page with a textarea
> (a GitHub issue comment box, or https://github.com/Kyu-seok/VimText/issues/new),
> click into the textarea, type a few words, then press Esc. A strip appears
> at the edge of the field reading NORMAL; the cursor becomes a block. Then:
>
> - Normal mode: press `0`, `w`, `dw`, `u`. The strip reads NORMAL.
> - Visual mode: press `v` and move with `l`; the strip reads VISUAL. Esc
>   returns to Normal.
> - Insert mode: press `i`; the strip dims and reads INSERT; typing is native
>   again. Esc returns to Normal.
> - Replace mode: press `R` and type; the strip reads REPLACE. Esc returns to
>   Normal.
> - Command line: press `:` and the strip becomes a command line; type `s/a/b/`
>   and Enter.
> - Clipboard: press `"+yy` then `"+p` to see the two clipboard permissions in
>   use; nothing else touches the clipboard.
>
> The extension's toolbar popup shows the global on/off switch, the Site Policy
> for the current site and the Mode of the focused field. The options page
> (right-click the icon, Options) holds the vimrc box, the Plugin toggles and
> the Site Policy table.
>
> There are no network requests, no analytics and no remote code. The source
> is at https://github.com/Kyu-seok/VimText and the privacy policy at
> https://github.com/Kyu-seok/VimText/blob/main/PRIVACY.md.
