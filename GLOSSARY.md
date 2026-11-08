# VimText

VimText is a Chrome extension that gives Vim's modal editing to the text fields of ordinary web pages, editing the page's own field in place with no native host installed.

## Language

**Field**:
An editable element on a web page that VimText can attach to, such as a textarea, a single-line text input, or (later) a contenteditable region.
_Avoid_: input, element, editor, box

**Single-line Field**:
A Field that cannot hold a newline, such as a text, search, url, email or tel input. Commands that would open a new line have nowhere to go on it.
_Avoid_: single-line input, input field, one-line box

**Controlled Field**:
A Field whose page rewrites its value in response to edits, as React controlled components, input masks and uppercase filters do. The page's rewrite is the truth; VimText follows it.
_Avoid_: framework field, React input, managed input

**Activate**:
The moment VimText takes control of a focused Field: on its first Esc or Ctrl+[ when the Start Mode is Insert, or as soon as it is focused when the Start Mode is Normal. Before activation VimText is inert on that Field and shows nothing; after activation the Field stays under VimText's control until it leaves the page.
_Avoid_: enable, wake, turn on

**Mode**:
The Vim editing mode a Field is currently in: Insert, Normal, Visual (charwise, linewise, blockwise), Replace, or Command-line.

**Status Line**:
The strip VimText shows at the bottom edge of an activated Field: the current Mode, pending keys, macro-recording indicator, the command line for `:` `/` `?`, and messages such as Vim errors.
_Avoid_: overlay, badge, mode indicator, HUD

**Start Mode**:
The Mode a Field is placed in when it is Activated. The global default is Insert; a Site Policy can set it to Normal.
_Avoid_: default mode, initial mode

**Site Policy**:
The user's per-site settings: whether VimText is enabled there and which Start Mode applies.
_Avoid_: whitelist, blacklist, exclusion list

**Baseline**:
Behaviour that Vim itself has, as documented in Vim's `:help`. The Baseline is the oracle for what "correct" means.
_Avoid_: core, builtin, native vim

**Plugin**:
An opt-in behaviour modelled on a well-known Vim plugin (for example surround or targets) that is not part of the Baseline. Plugins are off by default.
_Avoid_: extension, add-on, feature flag

**Pass-through**:
A key press that VimText deliberately lets reach the page untouched, even while a Field is in a non-Insert Mode (for example Cmd+Enter or Tab).
_Avoid_: ignored key, unhandled key

**Key Policy**:
The fixed set of keys VimText decides on before the engine sees them while a Field is in a non-Insert Mode: some are Pass-through, others are swallowed because the Field cannot act on them (a new line on a Single-line Field). A vimrc mapping never reaches a key the Key Policy has decided.
_Avoid_: key filter, hotkey table, interception list

**Session State**:
The Vim state shared by every Field in every tab for as long as the browser session lasts: registers, macros, search and command history, and the user's vimrc mappings. Marks and undo history are not Session State; they belong to one Field.
_Avoid_: global state

**vimrc**:
The user's configuration, written as Vim ex commands (`map`, `set`, ...) and applied to every Field. Site Policies and Plugin toggles are not part of the vimrc.
_Avoid_: config, settings, keybindings
