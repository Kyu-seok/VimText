---
status: accepted
---

# Site Policy is keyed by the top page's origin, resolved in each frame from `ancestorOrigins`

Decided in the M2 part 2 grill of 2026-11-08 (issue #11). The content script runs in every frame, and a frame's Fields are governed by the policy of the **Site**: the origin of the page in the tab's address bar, which the frame reads as the last entry of `location.ancestorOrigins`. A top-level document is its own Site. Where that list is empty (Firefox, which does not implement it) the frame falls back to its own origin.

## Considered options

- **Key by the frame's own origin** (M1 behaviour): a user could silence an embedded widget (Stripe card inputs, a Disqus box) on every page at once, but the popup only ever shows the top origin, so no user could actually pick that key; a Site Policy of "normal" set from the popup would never reach a Field in a cross-origin frame.
- **Combine both** ("off" if either origin says off): two keys for one Field, with no UI to explain which one won.
- **Read the top origin from `document.referrer`**: the parent, not the top, and stripped by referrer policies.

## Consequences

- The popup, the address bar and the stored key agree: "this site" means the page the user is on.
- A frame depends on a Chrome-only, non-standard list; the Firefox fallback leaves cross-origin frames there under their own origin (recorded in `DESIGN.md` accepted limitations).
- Stored keys are origins of top pages only; migrating to another keying would mean rewriting user settings.
- `about:blank` and `srcdoc` frames would resolve the same Site, but the manifest does not inject into them yet.
