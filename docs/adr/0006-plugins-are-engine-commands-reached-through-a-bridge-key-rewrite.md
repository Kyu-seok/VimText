---
status: accepted
---

# Plugins are engine commands reached through a bridge key rewrite

Decided in the M3 part 2 grill of 2026-11-08. A Plugin (surround, targets) is a set of engine operators, motions and actions defined through the engine's `define*` API and bound with `mapCommand` on every Activation. Its typed key sequences never reach the engine as typed: the engine's matcher takes a full match over a partial one and never waits, so `d` is consumed as an operator before `s` arrives and `in` is a text object before `(` arrives. One hook in the bridge, where the `"*` rewrite already lives, holds the ambiguous keys and feeds a **Plugin Key** (`<SurroundDs>`, a key name no keyboard produces) when the sequence completes, or releases the held keys in order when it does not. Grammar lives in the hook; semantics, counts, `.` and macros stay the engine's.

## Considered options

- **Keymap bindings only** (`ds<character>` via `mapCommand`): cannot fire; `d` wins as a full match and operator-pending never searches actions. The same engine rule is already recorded as the vimrc prefix limitation.
- **Monkey-patch the engine's `handleKey`** from the Plugin module: catches macro replay too, but hides a key state machine behind a property assignment on a pinned dependency, untestable at the bridge's seams.
- **Fork the matcher** (add `timeoutlen`): forbidden by ADR 0001's "never a fork".
- **Drop surround and the `n`/`l` prefixes**: removes the Plugins people install first.

## Consequences

- The bridge knows two grammars (surround's `[ycd]s`, targets' `[ia][nl]`) and nothing of what they mean.
- A held key is invisible on the Status Line for one keystroke; macros record Plugin Keys rather than typed keys; a vimrc `noremap` cannot reach a Plugin key. All listed in `DESIGN.md` accepted limitations.
- Plugin bindings are applied before the vimrc, so a vimrc mapping on a shared key wins, as in Vim.
