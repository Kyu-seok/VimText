# Coding standards

Read during review. Terms as defined in `GLOSSARY.md`.

## Judgement calls

1. **The Field is the truth.** When the Field and the mirror disagree, code reconciles toward the Field (`Session.syncFromField`). Code that makes the mirror win is wrong unless the engine just produced that state and `render()` is about to land it in the Field.
2. **Every write to the Field goes through `Session.render()`.** It keeps `lastRendered` correct, which is how a later sync tells a user's mouse click from our own cursor. A `field.setValue` or `field.setSelection` call anywhere else is a bug.
3. **Engine semantics are upstream.** When behaviour differs from Vim's `:help`, the fix is an upstream issue or an entry under "Accepted limitations" in `DESIGN.md`, never a patch in the bridge. The bridge adapts the engine to the page (focus, input field, undo grouping); it does not change what a key means.
4. **Insert mode stays native.** The whitelist in `isInsertModeVimKey` (`src/bridge/Session.ts`) is the only place a key is taken from Insert mode, and adding one needs a decision recorded in `DESIGN.md`. The one extension is the keys that complete a whitelisted key the engine is still waiting on (the register after `Ctrl-r`).

## Mechanical

Enforced in `npm run check`, listed here so the reviewer knows it is covered:

- `tools/check-imports.mjs`: `@replit/codemirror-vim` and `@codemirror/{view,commands,language,search}` are imported only under `src/engine/`. `@codemirror/state` is shared vocabulary (positions, selections) and may be used anywhere in `src/`.
- `knip` (`knip.json`): no unused files, exports, exported types, or dependencies. It does not see unused interface or class members; those stay a reviewer's call.
