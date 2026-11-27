import type * as Monaco from "monaco-editor";
import { test, expect } from "./extension";
import { MONACO_TEXT, monacoHistory, monacoText, openMonaco } from "./monaco";

// The Monaco facts the Monaco Field rests on (docs/engine-seams.md, the
// "Monaco: …" entries; CODING_STANDARDS rule 12), observed on the real package
// with VimText standing down: the setting is off, so none of its code acts on
// the editor. Each `describe` is named after its engine-seams entry.

type Editor = Monaco.editor.IStandaloneCodeEditor;

/** Runs `fn` in the page with the fixture's editor. */
function withEditor<T, A>(
  page: import("@playwright/test").Page,
  fn: (ed: Editor, arg: A) => T,
  arg: A,
): Promise<T> {
  return page.evaluate(
    ([source, a]) => {
      const m = (window as unknown as { fixtureMonaco: typeof Monaco }).fixtureMonaco;
      const run = new Function(`return (${source as string})`)() as (ed: Editor, arg: A) => T;
      return run(m.editor.getEditors()[0] as Editor, a as A);
    },
    [fn.toString(), arg] as const,
  );
}

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
