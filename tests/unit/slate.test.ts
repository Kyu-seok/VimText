import { describe, it, expect, afterEach } from "vitest";
import { Session } from "../../src/bridge/Session";
import { ContentEditableField } from "../../src/field/ContentEditableField";
import { mountSlate, modelLines, type SlateFixture } from "../fixtures/slate-editor";
import { caretAt } from "./contenteditable";

/**
 * VimText on the pinned Slate build (#54, ADR 0008) through a Session, for the
 * timing cases the e2e cannot make deterministic: writes back to back, with
 * no key's worth of time between them. Slate ignores `selectionchange` for a
 * while after it renders (docs/engine-seams.md, "Slate ignores
 * selectionchange after it renders"), so a write that reselects right after
 * the previous one settled would be applied at Slate's stale selection. The
 * tests read Slate's own model, never the DOM: a Diverged Edit hides there.
 */

let current: {
  slate: SlateFixture;
  field: ContentEditableField | null;
  session: Session | null;
  place: HTMLElement;
} | null = null;

afterEach(() => {
  if (current) {
    current.session?.destroy();
    current.field?.destroy();
    current.slate.unmount();
    current.place.remove();
  }
  current = null;
  document.body.innerHTML = "";
});

/** Slate mounted, focused, its caret at the start, and a Session on its host once Slate has taken that caret. */
async function open() {
  const place = document.createElement("div");
  place.style.cssText = "width:480px;font:14px/20px monospace";
  document.body.appendChild(place);
  const slate = mountSlate(place);
  slate.host.focus();
  caretAt(slate.host.querySelector("[data-slate-string]")!.firstChild!, 0);
  // Slate takes a selection on its throttled `selectionchange` handler.
  await new Promise((r) => setTimeout(r, 150));
  const field = new ContentEditableField(slate.host);
  const session = new Session(field, { vimrc: "" });
  current = { slate, field, session, place };
  return current;
}

/** Feeds `seq` as one burst: every key at once, none waiting for the write before it to settle. */
async function burst(seq: string): Promise<void> {
  for (const key of seq) {
    current!.session!.handleKeydown(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  }
  await current!.session!.settled();
}

/** Each key once the write before it has settled: the next write right after, as `.` after `3x` typed fast. */
async function keys(seq: string): Promise<void> {
  for (const key of seq) await burst(key);
}

const model = () => modelLines(current!.slate.editor);

describe("Slate takes writes made back to back", () => {
  it("x then x, the second written the moment the first settles, both land", async () => {
    await open();
    await keys("wx");
    await keys("x");
    expect(model()[0]).toBe("the ick brown fox");
    expect(current!.field!.getValue().split("\n")[0]).toBe("the ick brown fox");
  });

  it("3x then . in one burst: the merged write lands too", async () => {
    await open();
    await burst("3x.");
    expect(model()[0]).toBe("ick brown fox");
  });

  it("a macro that edits two lines writes both spans of one write", async () => {
    await open();
    await keys("qaxjxkq");
    expect(model().slice(0, 2)).toEqual(["he quick brown fox", " heading"]);
    await keys("@a");
    expect(model().slice(0, 2)).toEqual(["e quick brown fox", "heading"]);
  });

  it("dd then dd in one burst removes both blocks from Slate's model", async () => {
    await open();
    await burst("jjdddd");
    expect(model()).toEqual(["the quick brown fox", "a heading", "last line"]);
  });
});

/**
 * docs/engine-seams.md, "Slate puts a stale selection back over a cursor
 * move" (#64): Slate takes VimText's Normal cursor late, on its throttled
 * `selectionchange` handler, and a cursor move VimText makes before React has
 * rendered that `set_selection` is dropped (its node map is dirty) and then
 * overwritten by the render, which puts the cursor Slate took back into the
 * DOM. Here the move is made at the worst moment, deterministically: in the
 * same task as Slate's late `set_selection`. The e2e met it under load, where
 * `G` then `iZ` typed the `Z` nowhere.
 */
describe("Slate puts a stale selection back over a cursor move", () => {
  it("G made as Slate takes the cursor before it keeps G's cursor, and a character typed after i lands there", async () => {
    await open();
    const { editor, host } = current!.slate;
    await keys("j");
    // Slate takes `j`'s cursor up to 100 ms later; `G` goes in that same task.
    await new Promise<void>((resolve) => {
      const onChange = editor.onChange;
      editor.onChange = (...args: Parameters<typeof onChange>) => {
        onChange(...args);
        if (!editor.operations.every((op) => op.type === "set_selection")) return;
        editor.onChange = onChange;
        current!.session!.handleKeydown(
          new KeyboardEvent("keydown", { key: "G", bubbles: true, cancelable: true }),
        );
        resolve();
      };
    });
    await new Promise((r) => setTimeout(r, 250)); // every throttled handler and render has run
    const lastLine = "the quick brown fox\na heading\nfirst item\nsecond item\n".length;
    expect(current!.field!.getSelection()).toEqual({ anchor: lastLine, head: lastLine + 1 });
    await keys("i");
    await new Promise((r) => setTimeout(r, 150));
    // A real keystroke's `beforeinput`: Slate inserts at the selection it flushes from the DOM.
    host.dispatchEvent(
      new InputEvent("beforeinput", { inputType: "insertText", data: "Z", bubbles: true, cancelable: true }),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(model()).toEqual(["the quick brown fox", "a heading", "first item", "second item", "Zlast line"]);
  });

  it("a character typed right after i, before Slate has rendered the cursor it took late, lands at i's caret", async () => {
    await open();
    const { editor, host } = current!.slate;
    await keys("G");
    // Slate takes `G`'s cursor late; `iZ` is typed before React renders it.
    await new Promise<void>((resolve) => {
      const onChange = editor.onChange;
      editor.onChange = (...args: Parameters<typeof onChange>) => {
        onChange(...args);
        if (!editor.operations.every((op) => op.type === "set_selection")) return;
        editor.onChange = onChange;
        const press = (key: string) => {
          const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
          current!.session!.handleKeydown(e);
          return e;
        };
        press("i");
        // Typed natively unless VimText took it: the browser's `beforeinput`.
        if (!press("Z").defaultPrevented) {
          host.dispatchEvent(
            new InputEvent("beforeinput", {
              inputType: "insertText",
              data: "Z",
              bubbles: true,
              cancelable: true,
            }),
          );
        }
        resolve();
      };
    });
    await current!.session!.settled();
    await new Promise((r) => setTimeout(r, 50));
    expect(model()).toEqual(["the quick brown fox", "a heading", "first item", "second item", "Zlast line"]);
  });
});

/**
 * docs/engine-seams.md, "Slate ignores selectionchange after it renders": a
 * bare-page probe, no VimText code running. Slate applies the `X` it took
 * over and renders it; that render puts Slate's caret back into the DOM and
 * sets a flag a `setTimeout` clears. A selection made and announced before
 * then is not taken, even at the next `beforeinput` (which otherwise flushes
 * the selection), so a deletion offered then is applied at Slate's caret
 * instead of the selected text. The same deletion offered once the flag has
 * cleared deletes the selection.
 */
describe("Slate ignores selectionchange after it renders", () => {
  async function probe(waitAfterRender: number): Promise<string[]> {
    const place = document.createElement("div");
    document.body.appendChild(place);
    const slate = mountSlate(place);
    current = { slate, place, field: null, session: null };
    slate.host.focus();
    caretAt(slate.host.querySelector("[data-slate-string]")!.firstChild!, 0);
    await new Promise((r) => setTimeout(r, 150)); // Slate takes the caret (its handler is throttled)
    const offer = (inputType: string, data: string | null = null) =>
      slate.host.dispatchEvent(
        new InputEvent("beforeinput", { inputType, data, bubbles: true, cancelable: true }),
      );
    // Called in the MutationObserver callback that sees the `X` rendered: a
    // microtask after React's commit, before any task (Slate's `setTimeout`).
    const rendered = new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        observer.disconnect();
        resolve();
      });
      observer.observe(slate.host, { subtree: true, childList: true, characterData: true });
    });
    offer("insertText", "X");
    await rendered;
    if (waitAfterRender > 0) await new Promise((r) => setTimeout(r, waitAfterRender));
    // `last` on the last line, selected and announced as a write does.
    const last = [...slate.host.querySelectorAll("[data-slate-string]")].at(-1)!.firstChild!;
    getSelection()!.setBaseAndExtent(last, 0, last, 4);
    document.dispatchEvent(new Event("selectionchange"));
    offer("deleteContentBackward");
    await new Promise((r) => setTimeout(r, 50));
    return modelLines(slate.editor);
  }

  it("a selection made right after it renders is not taken: the deletion lands at Slate's caret", async () => {
    const lines = await probe(0);
    expect(lines.at(-1)).toBe("last line");
    expect(lines[0]).toBe("the quick brown fox");
  });

  it("the same selection made once its flag has cleared is taken", async () => {
    const lines = await probe(30);
    expect(lines.at(-1)).toBe(" line");
    expect(lines[0]).toBe("Xthe quick brown fox");
  });
});
