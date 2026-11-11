# Synthetic cancelable `beforeinput` + `execCommand` fallback: spike results

Playwright 1.65.0 / Chromium 158.0.8127.18. lexical 0.53.0 (+rich-text, history), slate 0.147.4 / slate-react 0.147.5 / slate-history 0.144.0 / react 18.3.1, quill 2.0.3, ProseMirror at VimText's pins (prosemirror-view 1.42.8, same setup as tests/fixtures/prosemirror-editor.ts, `white-space: pre-wrap`), and a bare `contenteditable` div with `<p>` blocks. Date 2026-11-12.

Write step tested, per command: `setBaseAndExtent` + synthetic `selectionchange`; then `new InputEvent('beforeinput', {inputType, data, bubbles, cancelable, composed, targetRanges: [StaticRange(from the live selection)]})` dispatched on the editing host; if `!defaultPrevented`, `document.execCommand(...)`; then synthetic `selectionchange`. "Model" = Lexical `getTextContent()` per paragraph, Slate `Node.string` per block, Quill `getText()` split on `\n`, ProseMirror `textContent` per block, bare = DOM.

Harness: `page.html` (one editor per page), `run.mjs` (matrix; env `ED`, `CASES`, `CFGS`, `PHASE=type|undo`, `OUT`), `run-ext.mjs` + `ext/` (a real MV3 extension whose content script runs the write in the ISOLATED world), `pm.js` (esbuild bundle of `pm-entry.js` against the repo's node_modules), raw results `out*.json`.

Fixtures: A = `hello world` / `second line`; B = `hello ` + **`world`** + ` end` / `second line`.

## Table: outcome per editor x case

Outcome = model after the write (and DOM == model). `[P]` = editor called `preventDefault` (fallback skipped), `[-]+x` = not prevented, `execCommand` ran. "today" = execCommand only (current `replaceDomRange`). "bi sync" = the candidate with no await between steps (exactly how `replaceDomRange` runs today). "bi 20ms" = 20 ms between steps.

| Case (fixture, range, text) | expected | bare | ProseMirror | Lexical today | Lexical bi sync | Slate today | Slate bi sync | Quill today | Quill bi sync |
|---|---|---|---|---|---|---|---|---|---|
| insert `X` collapsed mid-text (A 0:5) | `helloX world` | correct, `[-]+x` both paths | correct `[-]+x` | correct | correct `[-]+x` (native path, no double) | diverged | correct `[-]+x` (native, no double) | correct | correct `[-]+x` |
| insert `XY` collapsed (A 0:5) | `helloXY world` | correct | correct | correct | correct `[-]+x` | diverged | correct `[P]` | correct | correct `[-]+x` |
| `x` at start of block 2 (A 1:0) | `Xsecond line` | correct | correct | correct | correct `[-]+x` | diverged | correct `[P]` | correct | correct `[-]+x` |
| `x` inside bold run (B 0:8) | `hello woxrld end` | correct | correct | correct | correct `[-]+x` | diverged | correct `[-]+x` | correct | correct `[-]+x` |
| `r`: `J` over 1 char (A 0:0-0:1) | `Jello world` | correct | correct | correct | correct `[P]` | diverged | correct `[P]` | correct | correct `[P]` |
| `cw`: `there` over 0:6-0:11 | `hello there` | correct | correct | correct | correct `[P]` | diverged | correct `[P]` | correct | correct `[P]` |
| delete in one text node (A 0:2-0:5) | `he world` | correct | correct | correct | correct `[P]` | diverged | correct `[P]` | correct | correct `[-]+x` |
| delete plain+bold (B 0:3-0:8) | `helrld end` | correct | correct | correct | correct `[P]` | diverged | correct `[P]` | correct | correct `[-]+x` |
| delete a whole bold word (B 0:6-0:11) | `hello  end` | correct | correct | **refused** | correct `[P]` | diverged | correct `[P]` | correct | correct `[-]+x` |
| delete boundary only (A 0:11-1:0) | `hello worldsecond line` | correct | correct | **refused** | correct `[P]` | diverged | correct `[P]` | correct | correct `[-]+x` |
| `dd` slid span (A 0:11-1:11) | `hello world` | correct | correct | **refused** | correct `[P]` | diverged | correct `[P]` | correct | correct `[-]+x` |
| Visual delete across blocks (A 0:8-1:3) | `hello woond line` | correct | correct | **wrong** (`hello wo`/`ond line`) | correct `[P]` | diverged | correct `[P]` | correct | correct `[-]+x` |
| `J`: boundary delete, then insertText `' '` (no reselect) | `hello world second line` | correct | correct | correct | correct `[P]`,`[-]+x` | diverged | **diverged + React `removeChild` NotFoundError**: model right, DOM `hello world second linesecond line` (sync and 1-microtask); **correct** with a task / 20 ms between steps | correct | correct |
| insertText `Z` over cross-block range (A 0:8-1:3) | `hello woZond line` | correct | correct | correct | correct `[P]` | diverged | correct `[P]` | correct | correct `[P]` |
| `o`: insertParagraph at end + `new` | `hello world`/`new`/... | correct | correct | **wrong** (`newsecond line`) | correct `[P]`,`[P]` | diverged | correct `[P]`,`[P]` | correct | correct `[-]+x` |
| `o` + one char `x` | `hello world`/`x`/... | correct | correct | **wrong** | correct `[P]`,`[P]` | diverged | correct | correct | correct |
| `r<CR>`: insertParagraph over 0:5-0:6 | `hello`/`world`/... | correct | correct | **wrong** (text loss: `world`) | correct `[P]` | diverged | correct `[P]` | correct | correct `[-]+x` |
| `A\nB` at 0:5 (text, split, 1 char) | `helloA`/`B world`/... | correct | correct | **wrong** | **wrong** sync: `B` lost (`[-]+x`,`[P]`,`[-]+x`); **correct** with 1 microtask / task / 20 ms between steps | diverged | correct (`B` at offset 0 is not native in Slate) | correct | correct |
| `A\nBC` at 0:5 | `helloA`/`BC world`/... | correct | correct | **wrong** | correct (`BC` prevented) | diverged | correct | correct | correct |
| two writes back to back: `ab` at 0:0, then delete 0:4-0:5 | `abhelo world` | correct | correct | wrong | **wrong** sync (`ahello world`: delete ran as Backspace from the editor's stale caret); correct with micro/task/20 ms | diverged | **wrong** sync, micro AND task (`ahello world`); **correct** at 20 ms | correct | correct |
| two writes: `o`+`new`, then delete `second` in block 3 | `hello world`/`new`/` line` | correct | correct | n/a | sync: block 3 not in the DOM yet; correct with micro/task/20 ms | diverged | sync/micro: block not rendered; task: **wrong** (`ne`); 20 ms: correct | correct | correct |

Bare and ProseMirror: every case `[-]+x` and byte-for-byte the same model/DOM text as the execCommand-only path, all timings (17+5 cases). ProseMirror's only `beforeinput` handler is an Android-only `deleteContentBackward` hack (prosemirror-view dist `handlers.beforeinput`), so a synthetic event never changes its behaviour on desktop.

With **20 ms between steps** (`timing: ms20`), all 22 cases are **correct** in Lexical, Slate and Quill, including the follow-up keystroke.

### Follow-up real keystroke (`page.keyboard.type('Q')` at end of block 1)
Every case that was correct after the write stayed correct after the keystroke, in every editor and timing (no Slate re-render clobbering: the model now holds the text). The failures listed above stay failed. Under today's path Slate loses the write on the keystroke as in the earlier doc (and after a structural divergence the keystroke lands in a ghost block, e.g. `rCR` → DOM `hello`/`Qhello world`).

### Undo (editor API: Lexical `UNDO_COMMAND`, `slate.undo()`, `quill.history.undo()`, PM `undo`, bare `execCommand('undo')`)
Restored the initial model in every correct case, all editors. Sync writes: 1 undo per write in all editors (Lexical merges the steps of one write; Slate batches same-tick ops; Quill merges within 1 s). With 20 ms between steps, Lexical and Slate need one undo per step (2-3 for `o`/`J`/split). The Slate `J` divergence did not undo (DOM stays broken).

### beforeinput target and inputType
- **Target**: the editing host works for every editor (they listen on the root; the event bubbles). Dispatching on the selection anchor's parent element gives identical results. No editor needed the anchor.
- **insertText** (`data` = text): handled by Lexical (prevents unless simple text insertion), Slate (prevents unless one `[a-z ]` char at a collapsed caret not at offset 0, no marks), Quill (prevents only over a non-collapsed target range). Collapsed simple inserts are left to the browser and the fallback `execCommand` makes them land: **no double application observed anywhere** (Lexical `unprocessedBeforeInputData` → `input`; Slate `deferredOperations` run in React `onInput`, fired synchronously by `execCommand`).
- **Delete**: use **`deleteContentBackward`**. `deleteContent` is *prevented and dropped* by both Lexical and Slate (model unchanged, fallback skipped: refused in all 6 delete cases). `deleteByCut` worked like `deleteContentBackward` in Lexical/Slate but is semantically a cut; not recommended. Quill and PM never prevent deletes (fallback does it, as today).
- **insertParagraph**: handled (prevented) by Lexical and Slate; Quill and PM leave it to the fallback.
- **targetRanges matter**: Slate maps them for `insertText`/`insertParagraph` (not for `delete*` except `deleteBy*`, where it relies on its selection, flushed from the synthetic `selectionchange` at `beforeinput`). Without targetRanges, Lexical's `J` came out wrong (`hello worldsecond line`).

## Isolated world (deciding fact): yes, it works
Tested with a real unpacked MV3 extension (content script, default ISOLATED world, `launchPersistentContext` headless `channel: 'chromium'`). The content script built the `InputEvent` with a `StaticRange` over page text nodes and dispatched it on the host. A page-world capture listener saw: `instanceof InputEvent` true, `isTrusted` false, the right `inputType`/`data`, `getTargetRanges().length === 1`, `[0] instanceof StaticRange` (the page world's constructor), `startContainer` the page's own text node inside the host, correct offsets. Lexical, Slate, Quill, ProseMirror and bare gave the same results as the in-page runs (8 cases + split; same Slate `J` sync failure; all correct at 20 ms). The content script also sees `defaultPrevented` set by page listeners. This matches the Input Events note that a script-created event's `getTargetRanges()` returns its `targetRanges`; the DOM objects are shared, only JS wrappers differ per world.

## Conclusions
1. **Yes for the models.** The candidate fixes every Lexical failure (refused deletes, wrong cross-block delete, `o`, `r<CR>` text loss) and every Slate divergence, and leaves Quill, ProseMirror and bare contenteditable unchanged. No double application.
2. **Main new risk: mixing a prevented step and a native step in one synchronous write.** When an editor prevents a step, it applies it to its model and re-renders the DOM *later* (Lexical: commit in a microtask; Slate: `onChange` microtask, then a React microtask). If the next step is one the editor lets through natively (Slate: one `[a-z ]` char; Lexical: simple insert), the fallback `execCommand` edits the stale DOM. Seen: Slate `J` (React `removeChild` crash, duplicated text, DOM/model diverged, undo cannot repair) and Lexical `A\nB` (`B` lost). Fix: yield between steps. Lexical needs one microtask; Slate needs a task (its render happens 2+ microtasks later).
3. **Between separate writes, Slate needs more than a task.** After rendering, Slate ignores `selectionchange` while `state.isUpdatingSelection` is set; a `setTimeout` from its layout effect clears it. A write that reselects inside that window is ignored, and then `deleteContentBackward` runs as Backspace from Slate's stale caret (`ahello world`). 20 ms between steps fixed every case; writes driven by separate key presses are naturally spaced. Synchronous multi-write commands (count/repeat, multi-range edits) need a deliberate wait, or need to send `targetRanges` on a type Slate honours.
4. **Delete must be `deleteContentBackward`.** Plain `deleteContent` is silently swallowed by Lexical and Slate.
5. Dispatch on the editing host; the anchor element is not needed.

## Surprises
- Lexical's `J` from the content script was `[P]`,`[P]`, but from the page it was `[P]`,`[-]+x` (timing of its commit relative to the second step). Both were correct.
- Lexical `deleteContent` → prevented with no effect (it handles only the directional/word/line types).
- Slate ignores `targetRanges` for `delete*` (except `deleteBy*`) by design ("those commands determine that for themselves"), so a delete depends entirely on the synthetic `selectionchange` being accepted.
- ProseMirror would run its Android-only Backspace hack on a synthetic `deleteContentBackward` on Android Chrome (no `isTrusted` check). It acts only if the DOM did not change within 50 ms; the fallback `execCommand` changes it, so it should be inert. Not tested on Android.
