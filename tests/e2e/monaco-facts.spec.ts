import { test, expect } from "./extension";
import {
  MONACO_TEXT,
  changeFromOutside,
  monacoHistory,
  monacoText,
  openMonaco,
  tallText,
  tokensReady,
  withEditor,
  type OutsideChange,
} from "./monaco";

// The Monaco facts the Monaco Field rests on (docs/engine-seams.md, the
// "Monaco: …" entries; CODING_STANDARDS rule 12), observed on the real package
// with VimText standing down: the setting is off, so none of its code acts on
// the editor. Each `describe` is named after its engine-seams entry.

/** Replaces the text from offset `from` to `to` with `text`, through the named API. */
function edit(
  page: import("@playwright/test").Page,
  how: "executeEdits" | "applyEdits",
  change: { from: number; to: number; text: string },
): Promise<void> {
  return withEditor(
    page,
    (ed, { how, change }) => {
      const model = ed.getModel()!;
      const a = model.getPositionAt(change.from);
      const b = model.getPositionAt(change.to);
      const op = {
        range: {
          startLineNumber: a.lineNumber,
          startColumn: a.column,
          endLineNumber: b.lineNumber,
          endColumn: b.column,
        },
        text: change.text,
      };
      if (how === "executeEdits") ed.executeEdits("test", [op]);
      else model.applyEdits([op]);
    },
    { how, change },
  );
}

test.beforeEach(async ({ page }) => {
  await openMonaco(page);
});

test.describe("Monaco: writing through the editor", () => {
  test("executeEdits lands the text byte for byte, with no indenting or bracket closing, and stays so", async ({
    page,
  }) => {
    const inserted = "\n{\nfoo(bar[\n";
    await edit(page, "executeEdits", { from: 20, to: 20, text: inserted });
    const expected = MONACO_TEXT.slice(0, 20) + inserted + MONACO_TEXT.slice(20);
    expect(await monacoText(page)).toBe(expected);
    await page.waitForTimeout(300);
    expect(await monacoText(page)).toBe(expected);
  });

  test("an executeEdits edit is one step of Monaco's undo stack", async ({ page }) => {
    await edit(page, "executeEdits", { from: 0, to: 21, text: "" });
    expect(await monacoText(page)).toBe(MONACO_TEXT.slice(21));
    await monacoHistory(page, "undo");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
    await monacoHistory(page, "redo");
    expect(await monacoText(page)).toBe(MONACO_TEXT.slice(21));
  });

  test("an applyEdits edit is not in the undo stack: undo takes back the edit before it", async ({
    page,
  }) => {
    await edit(page, "executeEdits", { from: 0, to: 1, text: "F" });
    await withEditor(page, (ed) => ed.pushUndoStop(), null);
    await edit(page, "applyEdits", { from: MONACO_TEXT.length, to: MONACO_TEXT.length, text: "end" });
    expect(await monacoText(page)).toBe("F" + MONACO_TEXT.slice(1) + "end");
    await monacoHistory(page, "undo");
    expect(await monacoText(page)).toBe(MONACO_TEXT + "end");
  });
});

test.describe("Monaco: undo stops", () => {
  test("two executeEdits edits with no pushUndoStop between them undo together", async ({ page }) => {
    await edit(page, "executeEdits", { from: 0, to: 1, text: "" });
    await edit(page, "executeEdits", { from: 0, to: 1, text: "" });
    expect(await monacoText(page)).toBe(MONACO_TEXT.slice(2));
    await monacoHistory(page, "undo");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
  });

  test("with pushUndoStop between them they undo one at a time", async ({ page }) => {
    await edit(page, "executeEdits", { from: 0, to: 1, text: "" });
    await withEditor(page, (ed) => ed.pushUndoStop(), null);
    await edit(page, "executeEdits", { from: 0, to: 1, text: "" });
    await monacoHistory(page, "undo");
    expect(await monacoText(page)).toBe(MONACO_TEXT.slice(1));
    await monacoHistory(page, "undo");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
  });

  test("an executeEdits edit right after typed text undoes with the typing", async ({ page }) => {
    await withEditor(page, (ed) => ed.focus(), null);
    await page.keyboard.type("xy");
    expect(await monacoText(page)).toBe("xy" + MONACO_TEXT);
    await edit(page, "executeEdits", { from: 2, to: 3, text: "" });
    await monacoHistory(page, "undo");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
  });
});

/** Monaco's selections as line numbers, the primary one first. */
function cursorLines(page: import("@playwright/test").Page): Promise<number[]> {
  return withEditor(page, (ed) => (ed.getSelections() ?? []).map((s) => s.positionLineNumber), null);
}

test.describe("Monaco: the view and the cursors", () => {
  test("setSelection on a line below the view does not scroll; revealPosition does", async ({ page }) => {
    await withEditor(page, (ed, text) => ed.setValue(text), tallText(200));
    const line150 = { lineNumber: 150, column: 1 };
    await withEditor(
      page,
      (ed, at) =>
        ed.setSelection({ ...at, endLineNumber: 150, endColumn: 1, startLineNumber: 150, startColumn: 1 }),
      line150,
    );
    await page.waitForTimeout(300);
    expect(await withEditor(page, (ed) => ed.getScrollTop(), null)).toBe(0);
    expect(await cursorLines(page)).toEqual([150]);
    await withEditor(page, (ed, at) => ed.revealPosition(at), line150);
    await expect.poll(() => withEditor(page, (ed) => ed.getScrollTop(), null)).toBeGreaterThan(0);
    await expect
      .poll(() =>
        withEditor(
          page,
          (ed) => ed.getVisibleRanges().some((r) => r.startLineNumber <= 150 && r.endLineNumber >= 150),
          null,
        ),
      )
      .toBe(true);
  });

  test("executeEdits keeps the extra cursors; setSelection leaves one", async ({ page }) => {
    await withEditor(
      page,
      (ed) =>
        ed.setSelections([
          { selectionStartLineNumber: 1, selectionStartColumn: 1, positionLineNumber: 1, positionColumn: 1 },
          { selectionStartLineNumber: 2, selectionStartColumn: 1, positionLineNumber: 2, positionColumn: 1 },
        ]),
      null,
    );
    await edit(page, "executeEdits", { from: 0, to: 1, text: "" });
    expect(await monacoText(page)).toBe(MONACO_TEXT.slice(1));
    expect(await cursorLines(page)).toEqual([1, 2]);
    await withEditor(
      page,
      (ed) => ed.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }),
      null,
    );
    expect(await cursorLines(page)).toEqual([1]);
  });
});

test.describe("Monaco: the cursor style", () => {
  test("the style a page did not set reads through getOption, not the raw options; updateOptions switches it and back", async ({
    page,
  }) => {
    const read = () =>
      withEditor(
        page,
        (ed) => ({
          raw: ed.getRawOptions().cursorStyle ?? null,
          // EditorOption.cursorStyle; TextEditorCursorStyle: Line 1, Block 2, Underline 3.
          option: ed.getOption(34),
          layer: ed.getDomNode()!.querySelector(".cursors-layer")!.className,
        }),
        null,
      );
    const before = await read();
    expect(before.raw).toBeNull();
    expect(before.option).toBe(1);
    expect(before.layer).toContain("cursor-line-style");
    await withEditor(page, (ed) => ed.updateOptions({ cursorStyle: "block" }), null);
    const block = await read();
    expect(block.option).toBe(2);
    expect(block.layer).toContain("cursor-block-style");
    await withEditor(page, (ed) => ed.updateOptions({ cursorStyle: "line" }), null);
    expect((await read()).option).toBe(1);
  });
});

test.describe("Monaco: changes from outside", () => {
  /**
   * Makes one edit, then `change`, and reports which of the editor's change
   * events fired during `change` and whether its content change was a flush.
   */
  function eventsOf(page: import("@playwright/test").Page, change: OutsideChange) {
    return (async () => {
      await edit(page, "executeEdits", { from: 0, to: 1, text: "F" });
      await withEditor(
        page,
        (ed) => {
          const seen: string[] = [];
          Object.assign(window, { seenChanges: seen });
          ed.onDidChangeModelContent((e) => seen.push(e.isFlush ? "content, a flush" : "content"));
          ed.onDidChangeModelLanguage(() => seen.push("language"));
          ed.onDidChangeModel(() => seen.push("model"));
        },
        null,
      );
      await changeFromOutside(page, change);
      return page.evaluate(() => (window as unknown as { seenChanges: string[] }).seenChanges);
    })();
  }

  test("setValue is a content change marked as a flush, and empties the undo stack", async ({ page }) => {
    expect(await eventsOf(page, { kind: "flush", text: "new text" })).toEqual(["content, a flush"]);
    await monacoHistory(page, "undo");
    expect(await monacoText(page)).toBe("new text");
  });

  test("an edit replacing the whole range is a content change, no flush, and can be undone", async ({
    page,
  }) => {
    expect(await eventsOf(page, { kind: "replace", text: "new text" })).toEqual(["content"]);
    expect(await monacoText(page)).toBe("new text");
    // With the edit before it, as no undo stop sits between them ("Monaco: undo stops").
    await monacoHistory(page, "undo");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
  });

  test("a language change is its own event with no content change, and keeps the undo stack", async ({
    page,
  }) => {
    expect(await eventsOf(page, { kind: "language", language: "plaintext" })).toEqual(["language"]);
    await monacoHistory(page, "undo");
    expect(await monacoText(page)).toBe(MONACO_TEXT);
  });

  test("a swapped model is its own event with no content change; the editor makes its elements anew, the old input off the page and the new one focused", async ({
    page,
  }) => {
    await withEditor(page, (ed) => ed.focus(), null);
    await page.evaluate(() =>
      Object.assign(window, {
        before: { input: document.activeElement, editor: document.querySelector("#editor .monaco-editor") },
      }),
    );
    expect(await eventsOf(page, { kind: "model", text: "another model" })).toEqual(["model"]);
    expect(await monacoText(page)).toBe("another model");
    expect(
      await page.evaluate(() => {
        const { input, editor } = (window as unknown as { before: { input: Element; editor: Element } })
          .before;
        const now = document.activeElement!;
        return {
          oldInputOnPage: input.isConnected,
          oldEditorOnPage: editor.isConnected,
          focusOnAnotherInput: now !== input && now.className === input.className,
        };
      }),
    ).toEqual({ oldInputOnPage: false, oldEditorOnPage: false, focusOnAnotherInput: true });
    expect(await withEditor(page, (ed) => ed.hasTextFocus(), null)).toBe(true);
  });
});

/** Focuses the editor with its caret at `offset` of the text. */
function caretAt(page: import("@playwright/test").Page, offset: number): Promise<void> {
  return withEditor(
    page,
    (ed, at) => {
      ed.focus();
      ed.setPosition(ed.getModel()!.getPositionAt(at));
    },
    offset,
  );
}

test.describe("Monaco: the suggestion popup", () => {
  const popup = "#editor .suggest-widget.visible";

  /** Types the start of `return`, a word of the text, on the text's empty last line. */
  async function typeRe(page: import("@playwright/test").Page): Promise<void> {
    await caretAt(page, MONACO_TEXT.length);
    await expect(page.locator(popup)).toHaveCount(0);
    await page.keyboard.type("re");
    await expect(page.locator(popup)).toHaveCount(1);
  }

  test("typing the start of a word opens a popup that shows as .suggest-widget.visible, and Esc closes it", async ({
    page,
  }) => {
    await typeRe(page);
    await page.keyboard.press("Escape");
    await expect(page.locator(popup)).toHaveCount(0);
  });

  test("with Esc stopped in the capture phase the popup stays open, until hideSuggestWidget is triggered on the editor", async ({
    page,
  }) => {
    await page.evaluate(() =>
      document.addEventListener(
        "keydown",
        (e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopImmediatePropagation();
        },
        true,
      ),
    );
    await typeRe(page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await expect(page.locator(popup)).toHaveCount(1);
    await withEditor(page, (ed) => ed.trigger("test", "hideSuggestWidget", null), null);
    await expect(page.locator(popup)).toHaveCount(0);
    expect(await monacoText(page)).toBe(MONACO_TEXT + "re");
  });

  test("hideSuggestWidget with no popup open changes nothing", async ({ page }) => {
    await caretAt(page, 5);
    await withEditor(page, (ed) => ed.trigger("test", "hideSuggestWidget", null), null);
    expect(await monacoText(page)).toBe(MONACO_TEXT);
    expect(await withEditor(page, (ed) => ed.getModel()!.getOffsetAt(ed.getPosition()!), null)).toBe(5);
  });

  test("Enter accepts the suggestion: the word is in the text", async ({ page }) => {
    await typeRe(page);
    await page.keyboard.press("Enter");
    expect(await monacoText(page)).toBe(MONACO_TEXT + "return");
  });
});

test.describe("Monaco: bracket closing", () => {
  /** Puts the caret at `offset`, types `(`, and returns the three characters from there. */
  async function typeParenAt(page: import("@playwright/test").Page, offset: number): Promise<string> {
    await caretAt(page, offset);
    await page.keyboard.type("(");
    return (await monacoText(page)).slice(offset, offset + 3);
  }
  const reset = (page: import("@playwright/test").Page) =>
    withEditor(page, (ed, text) => ed.setValue(text), MONACO_TEXT);

  test("( typed at a line's end, before a space or before a closing bracket is closed", async ({ page }) => {
    // Offset 20: the end of "function add(a, b) {".
    expect(await typeParenAt(page, 20)).toBe("()\n");
    await reset(page);
    // Offset 8: before the space of "function add".
    expect(await typeParenAt(page, 8)).toBe("() ");
    await reset(page);
    // Offset 17: before the ")" of "(a, b)".
    expect(await typeParenAt(page, 17)).toBe("())");
  });

  test("( typed where a setValue leaves the caret, the text's start, is before a word character and not closed", async ({
    page,
  }) => {
    await reset(page);
    await withEditor(page, (ed) => ed.focus(), null);
    await page.keyboard.type("(");
    expect((await monacoText(page)).slice(0, 3)).toBe("(fu");
  });

  test("( typed at a line's end right after a setValue is closed, ten times of ten", async ({ page }) => {
    for (let i = 0; i < 10; i++) {
      await reset(page);
      expect(await typeParenAt(page, 20)).toBe("()\n");
    }
  });

  test("( typed on a line below one Monaco has not tokenized yet, in the script that made the text or the line, is not closed; once the tokens are in, it is", async ({
    page,
  }) => {
    // Offset 36: the end of the second line, "  return a + b;".
    const typed = await withEditor(
      page,
      (ed, text) => {
        ed.setValue(text);
        ed.focus();
        ed.setPosition(ed.getModel()!.getPositionAt(36));
        ed.trigger("keyboard", "type", { text: "(" });
        return ed.getValue().slice(36, 38);
      },
      MONACO_TEXT,
    );
    expect(typed).toBe("(\n");

    await reset(page);
    await caretAt(page, 20);
    await page.keyboard.press("Enter");
    await page.keyboard.type("(");
    expect((await monacoText(page)).slice(20, 25)).toBe("\n  (\n");

    await reset(page);
    await caretAt(page, 20);
    await page.keyboard.press("Enter");
    await tokensReady(page);
    await page.keyboard.type("(");
    expect((await monacoText(page)).slice(20, 26)).toBe("\n  ()\n");
  });

  test("{ then Enter at a line's end leaves the caret on an indented line between the brackets", async ({
    page,
  }) => {
    await caretAt(page, MONACO_TEXT.length);
    await page.keyboard.type("{");
    await page.keyboard.press("Enter");
    await page.keyboard.type("y");
    expect(await monacoText(page)).toBe(MONACO_TEXT + "{\n  y\n}");
  });
});
