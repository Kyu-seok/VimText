---
status: accepted
---

# Dispose a Session promptly; a re-mounted element is a new Field

Decided in the M2 grill of 2026-11-07 (issue #8). A `MutationObserver` on the document (`childList`, `subtree`, and `attributes` filtered to `type`, `readonly`, `disabled`) disposes any Session whose element is disconnected or no longer qualifies as a text control. It runs only while at least one Session exists and also watches the shadow root of a Field that lives in one. A framework re-mount (React key change, conditional render) produces a new element and therefore a new Field: fresh Session, Start Mode per Site Policy, marks and undo gone, even with the same id.

## Considered options

- **Lazy sweep on the next `focusin`** (M1): no observer, but a removed Field's Status Line host and hidden mirror lived until something else took focus, and a single-page app could leave many behind.
- **Carry Session State across a re-mount by id**: ids are not stable identity in frameworks, and a Field's marks and undo belong to one element by the glossary's definition of Session State.
- **Observe each Field's ancestors individually**: one document-level observer is simpler and costs nothing while no Session exists.

## Consequences

- An element that turns `readonly`, `disabled` or `type="password"` loses its Session so keys reach the page natively; a password input revealed as `type="text"` qualifies from then on.
- The observer ignores VimText's own `<vimtext-status>` host insertions.
- Shadow-root Fields: activation already reaches them through `composedPath`, so the observer must observe that root too; the document alone never sees shadow-tree mutations.
