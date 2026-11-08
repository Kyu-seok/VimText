# Coding standards

Read during review. Terms as defined in `GLOSSARY.md`.

## Judgement calls

1. **The Field is the truth.** When the Field and the mirror disagree, code reconciles toward the Field (`Session.syncFromField`). Code that makes the mirror win is wrong unless the engine just produced that state and `render()` is about to land it in the Field.
2. **Every write to the Field goes through `Session.render()`.** It keeps `lastRendered` correct, which is how a later sync tells a user's mouse click from our own cursor. A `field.setValue` or `field.setSelection` call anywhere else is a bug.
3. **Engine semantics are upstream.** When behaviour differs from Vim's `:help`, the fix is an upstream issue or an entry under "Accepted limitations" in `DESIGN.md`, never a patch in the bridge. The bridge adapts the engine to the page (focus, input field, undo grouping); it does not change what a key means.
4. **Insert mode stays native.** The whitelist in `isInsertModeVimKey` (`src/bridge/Session.ts`) is the only place a key is taken from Insert mode, and adding one needs a decision recorded in `DESIGN.md`. The one extension is the keys that complete a whitelisted key the engine is still waiting on (the register after `Ctrl-r`).
5. **A routing or lifecycle change names its coverage.** A change to key routing, the render path, or Session lifecycle states which Modes (Normal, Visual, Insert, Replace) and Field placements (textarea, Single-line, a Field inside an open shadow root) it covers, with a test for each it touches, and re-reads the `GLOSSARY.md` terms it touches (Activate, Start Mode, Session State), correcting any that no longer describe the behavior: the M2 part 1 review let a Session lifecycle change through while the glossary still defined Activate without the Normal Start Mode and kept an Attach/Detach term for behavior never built. Replace mode and shadow-root Fields are the usual omissions: the M2 review found an Enter swallow that broke Replace mode and a disposal observer that never saw a shadow tree.
6. **Tests observe from outside.** A test feeds keys and asserts on what the user and the page see: the Field's value and selection, the Status Line text, the page's log. Reaching into the mirror, the engine's state, or the Status Line host's shadow DOM is a smell; drive the command line through the Session's own `status` instead. The one sanctioned read of the host is the `statusText` helper in `tests/e2e/extension.ts` and its unit-test twin: e2e has no Session handle, and the helper returns exactly the text the user sees.
7. **A test claims only what it asserts.** Its name and comments describe the assertion, not a hoped-for property. "No churn" with a value-equality check is a false claim when the value is static only because the page's filter is idempotent.
8. **A documented fallback is tested with the thing absent.** When `DESIGN.md` or an ADR says VimText falls back where a browser lacks an API (Firefox and `location.ancestorOrigins`), the code reads that API as optional and a unit test passes an object without it. TypeScript's DOM lib declares Chrome-only properties as required, so the typechecker never sees the throw; the M2 part 2 review found `siteOrigin` reading `ancestorOrigins.length` under docs that promised a Firefox fallback.

## Mechanical

Enforced in `npm run check`, listed here so the reviewer knows it is covered:

- `tools/check-imports.mjs`: `@replit/codemirror-vim` and `@codemirror/{view,commands,language,search}` are imported only under `src/engine/`. `@codemirror/state` is shared vocabulary (positions, selections) and may be used anywhere in `src/`.
- `tools/check-imports.mjs`: `chrome.*` appears under `src/` only in `src/content.ts` and `src/settings/settings.ts`. Everything else, `src/content/` included, runs in a plain Chromium page so the unit suite can drive it.
- `knip` (`knip.json`): no unused files, exports, exported types, or dependencies. It does not see unused interface or class members; those stay a reviewer's call.
