// VimText's page-world script (ADR 0010): the one piece of VimText that runs
// in the page's own JavaScript world, on every page. It is inert until
// VimText's content script asks: its one listener is for VimText's own request
// event, and it reads nothing, `window.monaco` included, before a request
// arrives. It finds Monaco only through `window.monaco`, and answers with
// offsets and text only (src/field/monacoProtocol.ts).
import type * as Monaco from "monaco-editor";
import {
  MONACO_ANSWER,
  MONACO_REQUEST,
  type MonacoAnswer,
  type MonacoEdit,
  type MonacoRequest,
} from "../field/monacoProtocol";

type Api = typeof Monaco;
type Editor = Monaco.editor.ICodeEditor;
type Model = Monaco.editor.ITextModel;

/**
 * The editor `input` is the input of, when it can be a Monaco Field: a code
 * editor with a model, writable, and not a side of a diff editor. Null otherwise.
 */
function editorOf(api: Api, input: Element): Editor | null {
  const editor = api.editor.getEditors().find((ed) => ed.getDomNode()?.contains(input));
  if (!editor?.getModel()) return null;
  const { readOnly, inDiffEditor } = api.editor.EditorOption;
  return editor.getOption(readOnly) || editor.getOption(inDiffEditor) ? null : editor;
}

/** How many characters a line end of the model is longer than the `\n` the offsets count. */
function extraPerLine(model: Model): number {
  return model.getEOL().length - 1;
}

function offsetAt(model: Model, position: Monaco.IPosition): number {
  return model.getOffsetAt(position) - (position.lineNumber - 1) * extraPerLine(model);
}

function positionAt(model: Model, offset: number): Monaco.IPosition {
  if (!extraPerLine(model)) return model.getPositionAt(offset);
  // The last line that starts at or before the offset.
  let line = 1;
  for (let high = model.getLineCount(); line < high;) {
    const middle = (line + high + 1) >> 1;
    if (offsetAt(model, { lineNumber: middle, column: 1 }) <= offset) line = middle;
    else high = middle - 1;
  }
  const column = offset - offsetAt(model, { lineNumber: line, column: 1 }) + 1;
  return model.validatePosition({ lineNumber: line, column });
}

function selectionOf(editor: Editor, model: Model): MonacoAnswer {
  const s = editor.getSelection();
  if (!s) return { anchor: 0, head: 0 };
  return {
    anchor: offsetAt(model, { lineNumber: s.selectionStartLineNumber, column: s.selectionStartColumn }),
    head: offsetAt(model, { lineNumber: s.positionLineNumber, column: s.positionColumn }),
  };
}

/**
 * The edits as one step of the editor's undo stack: `executeEdits` between two
 * undo stops, without which the step joins the edit or the typing before it
 * (docs/engine-seams.md, "Monaco: undo stops").
 */
function applyEdits(editor: Editor, model: Model, edits: MonacoEdit[]): void {
  const operations = edits.map(({ from, to, insert }) => {
    const start = positionAt(model, from);
    const end = positionAt(model, to);
    return {
      range: {
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
      },
      text: insert,
      forceMoveMarkers: true,
    };
  });
  editor.pushUndoStop();
  editor.executeEdits("vimtext", operations);
  editor.pushUndoStop();
}

function answerTo(api: Api, input: Element, request: MonacoRequest): MonacoAnswer | null {
  const editor = editorOf(api, input);
  const model = editor?.getModel();
  if (!editor || !model) return null;
  switch (request.op) {
    case "selection":
      break;
    case "read":
      return { ...selectionOf(editor, model), text: model.getValue(api.editor.EndOfLinePreference.LF) };
    case "edit":
      applyEdits(editor, model, request.edits);
      break;
    case "select": {
      const anchor = positionAt(model, request.anchor);
      const head = positionAt(model, request.head);
      editor.setSelection({
        selectionStartLineNumber: anchor.lineNumber,
        selectionStartColumn: anchor.column,
        positionLineNumber: head.lineNumber,
        positionColumn: head.column,
      });
      editor.revealPosition(head);
      break;
    }
    default:
      return null;
  }
  return selectionOf(editor, model);
}

window.addEventListener(
  MONACO_REQUEST,
  (e) => {
    const input = e.composedPath()[0];
    const detail = (e as CustomEvent<unknown>).detail;
    if (!(input instanceof Element) || typeof detail !== "string") return;
    let answer: MonacoAnswer | null;
    try {
      const api = (window as { monaco?: Api }).monaco;
      if (!api) return;
      answer = answerTo(api, input, JSON.parse(detail) as MonacoRequest);
    } catch {
      // A page whose `monaco` is not Monaco's API, or an editor disposed meanwhile: no answer.
      return;
    }
    if (answer) input.dispatchEvent(new CustomEvent(MONACO_ANSWER, { detail: JSON.stringify(answer) }));
  },
  true,
);
