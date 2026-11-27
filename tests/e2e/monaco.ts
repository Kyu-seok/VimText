import type { BrowserContext, Page } from "@playwright/test";
import type * as Monaco from "monaco-editor";
import { ready, setSettings } from "./extension";

export { MONACO_TEXT } from "../fixtures/monaco-text";

// The shared helpers of the Monaco fixture's specs (tests/fixtures/monaco.ts):
// opening the page with the editor a spec needs, switching the setting on, and
// reading or driving the editor through Monaco itself, never the DOM, which
// holds only the lines in view. Every read goes through the fixture's own
// `window.fixtureMonaco`, which is there whether or not the page exposes
// `window.monaco`.

/** The editor the fixture page makes (its query string, tests/fixtures/monaco.ts). */
export interface MonacoPage {
  /** Monaco takes input through an EditContext instead of `textarea.inputarea`. */
  editContext?: boolean;
  /** False: the page keeps Monaco to itself, with no `window.monaco`. */
  expose?: boolean;
  readOnly?: boolean;
  /** A diff editor instead of a code editor. */
  diff?: boolean;
  /** The model's line ends are `\r\n`. */
  eol?: "crlf";
}

type FixtureWindow = Window & { fixtureMonaco: typeof Monaco; pageKeys: string[] };

/** Stored settings with the Monaco Field switched on or off, the rest at their defaults unless given. */
export async function setMonacoSetting(
  context: BrowserContext,
  on: boolean,
  rest: { sites?: Record<string, string>; vimrc?: string } = {},
): Promise<void> {
  await setSettings(context, { enabled: true, sites: {}, vimrc: "", plugins: {}, ...rest, monaco: on });
}

/** Opens the Monaco fixture and waits for its editor and for VimText's settings. */
export async function openMonaco(page: Page, options: MonacoPage = {}): Promise<void> {
  const query = new URLSearchParams();
  if (options.editContext) query.set("editContext", "1");
  if (options.expose === false) query.set("expose", "0");
  if (options.readOnly) query.set("readOnly", "1");
  if (options.diff) query.set("diff", "1");
  if (options.eol) query.set("eol", options.eol);
  await page.goto(`/monaco.html?${query.toString()}`);
  await page.waitForSelector('html[data-monaco="ready"]', { state: "attached" });
  await ready(page);
}

/**
 * Gives the editor text focus, its caret at `offset` of the text. `editor` is
 * the index among `monaco.editor.getEditors()`: 0 unless the page has several
 * (a diff editor's original is 0 and its modified side 1).
 */
export async function focusMonaco(page: Page, offset = 0, editor = 0): Promise<void> {
  await page.evaluate(
    ([at, index]) => {
      const ed = (window as unknown as FixtureWindow).fixtureMonaco.editor.getEditors()[index!]!;
      ed.focus();
      ed.setPosition(ed.getModel()!.getPositionAt(at!));
    },
    [offset, editor],
  );
}

/** The text Monaco holds, line ends as the model has them. */
export function monacoText(page: Page, editor = 0): Promise<string> {
  return page.evaluate(
    (index) => (window as unknown as FixtureWindow).fixtureMonaco.editor.getEditors()[index]!.getValue(),
    editor,
  );
}

/** Monaco's selections as offsets into its text, the primary one first. */
export function monacoSelections(page: Page, editor = 0): Promise<{ anchor: number; head: number }[]> {
  return page.evaluate((index) => {
    const ed = (window as unknown as FixtureWindow).fixtureMonaco.editor.getEditors()[index]!;
    const model = ed.getModel()!;
    return (ed.getSelections() ?? []).map((s) => ({
      anchor: model.getOffsetAt({ lineNumber: s.selectionStartLineNumber, column: s.selectionStartColumn }),
      head: model.getOffsetAt({ lineNumber: s.positionLineNumber, column: s.positionColumn }),
    }));
  }, editor);
}

/** One step of Monaco's own undo stack back (`undo`) or forward (`redo`): what its Cmd+Z does. */
export async function monacoHistory(page: Page, step: "undo" | "redo", editor = 0): Promise<void> {
  await page.evaluate(
    ([command, index]) =>
      (window as unknown as FixtureWindow).fixtureMonaco.editor
        .getEditors()
        [index as number]!.trigger("test", command as string, null),
    [step, editor] as const,
  );
}

/** The keys of the `keydown` events that reached the page's own listener on the editor's element. */
export function pageKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as FixtureWindow).pageKeys);
}
