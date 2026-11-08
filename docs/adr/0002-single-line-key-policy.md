---
status: accepted
---

# Single-line Fields: strip the newline in the bridge, decide `o`/`O` as Key Policy

Decided in the M2 grill of 2026-11-07 (issue #7). A Single-line Field (`<input>` text, search, url, email, tel) is served by the same Field implementation as a textarea; the bridge, not the engine, enforces that its mirror never holds a newline. After any engine dispatch that leaves one (linewise `p`, `:put`, `Ctrl-r` with a multi-line register, `:s/x/\r/`) the render path strips it as the input's own value sanitization would, in a change joined to the command's undo step. `o`/`O` in Normal are a Key Policy row (swallowed as a beep, pending count dropped), decided before the engine sees the key, like Enter and Tab.

## Considered options

- **Engine mapping per Field type** (`nnoremap o A` for inputs): `Vim.map` is global across every mirror, so it cannot be scoped to one Field; and remapping changes what the key means, which rule 3 of `CODING_STANDARDS.md` forbids.
- **Let the engine hold the newline and strip only on write**: the engine and the Field would disagree, the next keystroke's self-heal would record the strip as its own undo step, and `u` would restore a newline the Field cannot show.
- **A second Field class for inputs**: nothing differs but `singleLine`, so a class would duplicate the textarea code.

## Consequences

- Linewise paste concatenates (`yyp` on `ab` gives `abab`); recorded under accepted limitations in `DESIGN.md`.
- Key Policy rows pre-empt vimrc mappings: `nnoremap o …` never fires on a Single-line Field.
- `j k gg G Ctrl-d Ctrl-u` need no code; they are engine no-ops on a one-line document.
- A 2nd Esc on a `type="search"` Field clears it natively; `u` restores. No special case.
