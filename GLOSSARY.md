# VimText

VimText is a Chrome extension that gives Vim's modal editing to the text fields of ordinary web pages, editing the page's own field in place with no native host installed.

## Language

**Field**:
An editable element on a web page that VimText can attach to: a textarea, a single-line text input, or a contenteditable Field. To Vim every Field is plain text; formatting is not part of it.
_Avoid_: input, element, editor, box

**contenteditable Field**:
A Field that is one editing host: the outermost editable element of a rich-text region, such as Gmail's compose body or Stack Overflow's answer editor. Its text is its plain text, each block a line; regions marked non-editable inside it belong to it. A page that makes every block its own editing host (Notion) has one Field per block.
_Avoid_: rich-text field, contenteditable region, editor

**Atom**:
Something inside a contenteditable Field that is not text but sits in it like a character: a mention chip, an inline image, a non-editable island. To Vim it is one character; yanked, it is its visible text.
_Avoid_: embed, node, widget, chip

**Single-line Field**:
A Field that cannot hold a newline: a text, search, url, email or tel input, or a contenteditable Field that declares itself single-line. Commands that would open a new line have nowhere to go on it.
_Avoid_: single-line input, input field, one-line box

**Controlled Field**:
A Field whose page rewrites its value in response to edits, as React controlled components, input masks and uppercase filters do. The page's rewrite is the truth; VimText follows it.
_Avoid_: framework field, React input, managed input

**Refused Edit**:
An edit VimText writes to a Field that leaves the Field's text as it was, because the page refused it or put it back at once. The Field wins and the Status Line says so.
_Avoid_: rejected edit, reverted edit, blocked write

**Diverged Edit**:
An edit the page shows in a Field but its editor never takes in, so the editor later puts its own text back without telling anyone. VimText cannot see one; it is a defect to prevent, not a state to handle.
_Avoid_: reverted edit, lost edit, desync

**Activate**:
The moment VimText takes control of a focused Field: on its first Esc or Ctrl+[ when the Start Mode is Insert, or as soon as it is focused when the Start Mode is Normal. Before activation VimText is inert on that Field and shows nothing; after activation the Field stays under VimText's control until it leaves the page or stops qualifying (see **Session**).
_Avoid_: enable, wake, turn on

**Mode**:
The Vim editing mode a Field is currently in: Insert, Normal, Visual (charwise, linewise, blockwise), Replace, or Command-line.

**Status Line**:
The strip VimText shows at the edge of an activated Field, below it when there is room and above it otherwise: the current Mode, pending keys, macro-recording indicator, the command line for `:` `/` `?`, and messages such as Vim errors.
_Avoid_: overlay, badge, mode indicator, HUD

**Start Mode**:
The Mode a Field is placed in when it is Activated. The global default is Insert; a Site Policy can set it to Normal.
_Avoid_: default mode, initial mode

**Site**:
The origin of the page in the tab's address bar. Every frame that page embeds, same-origin or not, belongs to that Site; a Field in an embedded frame is on the Site of the page around it.
_Avoid_: domain, host, frame origin, page

**Site Policy**:
The user's settings for one Site: whether VimText is enabled there and which Start Mode applies. The same policy governs every Field on the Site, including those in embedded frames.
_Avoid_: whitelist, blacklist, exclusion list

**Baseline**:
Behaviour that Vim itself has, as documented in Vim's `:help`. The Baseline is the oracle for what "correct" means.
_Avoid_: core, builtin, native vim

**Plugin**:
An opt-in behaviour modelled on a well-known Vim plugin (for example surround or targets) that is not part of the Baseline. The upstream plugin's own documentation is its oracle, as `:help` is the Baseline's. Plugins are off by default.
_Avoid_: extension, add-on, feature flag

**Plugin Key**:
A key name private to a Plugin that no keyboard produces, which VimText substitutes for the sequence a person types (`ds` becomes one Plugin Key before the engine sees it).
_Avoid_: internal key, synthetic key, pseudo-key

**Seek**:
What targets does when the cursor is not inside the requested text object: it looks ahead on the line for the next one, then behind for the last; for a pair, other lines after that (targets.vim's default seek ranges).
_Avoid_: search, jump, scan

**Pass-through**:
A key press that VimText deliberately lets reach the page untouched, even while a Field is in a non-Insert Mode (for example Cmd+Enter or Tab).
_Avoid_: ignored key, unhandled key

**Key Policy**:
The fixed set of keys VimText decides on before the engine sees them while a Field is in a non-Insert Mode: some are Pass-through, others are swallowed because the Field cannot act on them (a new line on a Single-line Field). A vimrc mapping never reaches a key the Key Policy has decided.
_Avoid_: key filter, hotkey table, interception list

**Session**:
The Vim engine and its mirror attached to one Activated Field, living from Activation until the Field leaves the page or stops qualifying. A Field's marks and undo history live in its Session.
_Avoid_: instance, attachment, editor

**Session State**:
The Vim state shared by every Field in every tab for as long as the browser session lasts: registers, macros, search and command history, and the last `f`/`t` character search. Marks, undo history and the jump list are not Session State; they belong to one Field. The vimrc is a Setting, not Session State: its mappings are in every tab because every tab runs it.
_Avoid_: global state

**vimrc**:
The user's configuration, written as Vim ex commands (`map`, `set`, ...) and applied to every Field. Site Policies and Plugin toggles are not part of the vimrc.
_Avoid_: config, settings, keybindings
