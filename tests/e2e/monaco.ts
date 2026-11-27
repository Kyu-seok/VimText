import { test, type BrowserContext, type Page } from "@playwright/test";
import type * as Monaco from "monaco-editor";
import { ready, setSettings } from "./extension";
import type { MonacoInputOption } from "./monaco-option";

export { MONACO_TEXT } from "../fixtures/monaco-text";

// The shared helpers of the Monaco fixture's specs (tests/fixtures/monaco.ts):
// opening the page with the editor a spec needs, switching the setting on, and
// reading or driving the editor through Monaco itself, never the DOM, which
// holds only the lines in view. Every read goes through the fixture's own
// `window.fixtureMonaco`, which is there whether or not the page exposes
// `window.monaco`.
//
// Both input kinds (#117): a `monaco*.spec.ts` runs twice, in the `e2e` project
// on `textarea.inputarea` and in `e2e monaco edit-context` on the EditContext
// input (playwright.config.ts). `openMonaco` picks the kind from the project,
// so a spec passes no `editContext` and reads no element by its class; a case
// whose expectation differs by kind asks `monacoInputKind()`.

/** The editor the fixture page makes (its query string, tests/fixtures/monaco.ts). */
export interface MonacoPage {
  /**
   * Monaco takes input through an EditContext instead of `textarea.inputarea`.
   * Left out, the project decides (`monacoInputKind`): leave it out unless the
   * case is about one input kind.
   */
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

/**
 * The input kind the running test's project asks for (playwright.config.ts):
 * `textarea.inputarea` in the `e2e` project, the EditContext input in
 * `e2e monaco edit-context`, which reruns the Monaco specs.
 */
export function monacoInputKind(): MonacoInputOption["monacoInput"] {
  return (test.info().project.use as Partial<MonacoInputOption>).monacoInput ?? "textarea";
}

/** Opens the Monaco fixture and waits for its editor and for VimText's settings. */
export async function openMonaco(page: Page, options: MonacoPage = {}): Promise<void> {
  const query = new URLSearchParams();
  if (options.editContext ?? monacoInputKind() === "editContext") query.set("editContext", "1");
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

/** Runs `fn` in the page with one of the fixture's editors; `fn` sees only its two arguments. */
export function withEditor<T, A>(
  page: Page,
  fn: (ed: Monaco.editor.IStandaloneCodeEditor, arg: A) => T,
  arg: A,
  editor = 0,
): Promise<T> {
  return page.evaluate(
    ([source, a, index]) => {
      const m = (window as unknown as FixtureWindow).fixtureMonaco;
      const run = new Function(`return (${source as string})`)() as (
        ed: Monaco.editor.IStandaloneCodeEditor,
        arg: A,
      ) => T;
      return run(m.editor.getEditors()[index as number] as Monaco.editor.IStandaloneCodeEditor, a as A);
    },
    [fn.toString(), arg, editor] as const,
  );
}

/** A text of `lines` lines, "line 1" to "line <lines>": taller than the fixture's editor from about 13 lines. */
export function tallText(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join("\n");
}

/** The editor's cursor style as Monaco names it: "Line", "Block", "Underline", … */
export function monacoCursorStyle(page: Page, editor = 0): Promise<string> {
  return page.evaluate((index) => {
    const m = (window as unknown as FixtureWindow).fixtureMonaco;
    const style = m.editor.getEditors()[index]!.getOption(m.editor.EditorOption.cursorStyle);
    return m.editor.TextEditorCursorStyle[style];
  }, editor);
}

/** The line the primary cursor is on, and whether the editor's view shows that line. */
export function monacoCursorLine(page: Page, editor = 0): Promise<{ line: number; inView: boolean }> {
  return page.evaluate((index) => {
    const ed = (window as unknown as FixtureWindow).fixtureMonaco.editor.getEditors()[index]!;
    const line = ed.getPosition()!.lineNumber;
    const top = ed.getTopForLineNumber(line) - ed.getScrollTop();
    const height = ed.getLayoutInfo().height;
    return { line, inView: top >= 0 && top < height };
  }, editor);
}
