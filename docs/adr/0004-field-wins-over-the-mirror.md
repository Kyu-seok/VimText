---
status: accepted
---

# Controlled Fields: the page's rewrite is the truth, joined to the undo step that provoked it

Decided in the M2 grill of 2026-11-07 (issue #9). Right after every write, the render path re-reads the Field. A synchronous rewrite by the page (React controlled component, input mask, uppercase filter) is synced into the mirror joined to the undo step of the change that provoked it, cursor at the page's caret clipped to the line in Normal. The render remembers the text it last wrote; a queued render whose Field no longer holds it does not write but reconciles from the Field, dropping the engine's pending change. The synthetic `input` event carries `inputType` and `data` from a diff of old and new text.

## Considered options

- **Mirror wins, write anyway**: overwrites what the page did, which rule 1 of `CODING_STANDARDS.md` forbids.
- **Sync the rewrite as its own undo step**: `u` would undo the rewrite, the page would rewrite again, and undo would never move backwards.
- **Patch the element's `value` property or poll for changes**: invasive on the page and still misses nothing the self-heal on the next key does not catch.
- **Dispatch `beforeinput` and honour cancellation**: deferred; a page that cancelled it would simply win under self-heal.
- **Sync an undo-provoked rewrite outside history (`addToHistory: false`)**: redo would survive but land at a mapped position inside the replaced range and delete the wrong character. Rejected during the M2 review; see issue #12.

## Consequences

- On a Field that reformats every edit the cursor may land where the page put the caret; no heuristics guess at it.
- Asynchronous rewrites (`setTimeout`) fire `input` on their own and stay separate undo steps.
- After `u` on a filtering page, redo is gone and further `u` appear to do nothing; recorded under accepted limitations in `DESIGN.md`, follow-up on issue #12.
- Test seams: a FakeField whose `setValue` can rewrite the value, a React 19 fixture bundled by the build, and a hand-written rewriting fixture.
