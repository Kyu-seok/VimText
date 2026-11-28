import { describe, it, expect, afterEach } from "vitest";
import { resolveField } from "../../src/field/resolve";
// VimText's page-world script itself, which adds its one listener on import.
import "../../src/page/monaco";

/**
 * Where `resolveField` refuses Monaco's input (ADR 0010; #121): the real
 * page-world script answers, against a stand-in for `window.monaco` holding
 * the editors a test gives it, as far as the script reads them. What is
 * observed is what `resolveField` decides; the real Monaco is the e2e suite's
 * (tests/e2e/monaco.spec.ts, "where the Monaco Field is refused";
 * tests/e2e/monaco-lifecycle.spec.ts, "Monaco's find and rename inputs remain
 * Fields of their own text").
 */

const READ_ONLY = 1;
const IN_DIFF_EDITOR = 2;

interface StandInEditor {
  readOnly?: boolean;
  inDiffEditor?: boolean;
}

afterEach(() => {
  delete (window as { monaco?: unknown }).monaco;
  document.body.innerHTML = "";
});

/** Monaco's element with `input` in it, in the document. */
function editorElement(input: HTMLElement): HTMLElement {
  const el = document.createElement("div");
  el.className = "monaco-editor";
  el.appendChild(input);
  document.body.appendChild(el);
  return el;
}

/** Monaco's code input, `textarea.inputarea`, in an editor element of its own. */
function codeInput(): { input: HTMLTextAreaElement; element: HTMLElement } {
  const input = document.createElement("textarea");
  input.className = "inputarea";
  return { input, element: editorElement(input) };
}

/**
 * Sets `window.monaco` to a stand-in whose editors are `editors`, each on its
 * element, holding the text "code". Returns how many times the script asked
 * it for its editors.
 */
function standInMonaco(editors: [HTMLElement, StandInEditor][]): { asked: number } {
  const seen = { asked: 0 };
  const model = {
    getEOL: () => "\n",
    getOffsetAt: () => 0,
    getValue: () => "code",
  };
  const made = editors.map(([element, options]) => ({
    getDomNode: () => element,
    getModel: () => model,
    getOption: (option: number) =>
      option === READ_ONLY ? !!options.readOnly : option === IN_DIFF_EDITOR ? !!options.inDiffEditor : 0,
    getSelection: () => null,
    onDidChangeModelContent: () => {},
    onDidChangeModelLanguage: () => {},
  }));
  (window as { monaco?: unknown }).monaco = {
    editor: {
      getEditors: () => {
        seen.asked++;
        return made;
      },
      EditorOption: { readOnly: READ_ONLY, inDiffEditor: IN_DIFF_EDITOR },
      EndOfLinePreference: { LF: 1 },
    },
  };
  return seen;
}

describe("resolveField on Monaco's input, against VimText's page-world script", () => {
  it("is a Monaco Field on a writable code editor's input", () => {
    const { input, element } = codeInput();
    standInMonaco([[element, {}]]);
    const resolved = resolveField(input, { monaco: true });
    expect(resolved?.element).toBe(input);
    expect(resolved!.create().getValue()).toBe("code");
  });

  it("is not a Field on a read-only editor's input", () => {
    const { input, element } = codeInput();
    standInMonaco([[element, { readOnly: true }]]);
    expect(resolveField(input, { monaco: true })).toBeNull();
  });

  it("is not a Field on the input of either side of a diff editor, the writable modified side included", () => {
    const original = codeInput();
    const modified = codeInput();
    standInMonaco([
      [original.element, { readOnly: true, inDiffEditor: true }],
      [modified.element, { inDiffEditor: true }],
    ]);
    expect(resolveField(original.input, { monaco: true })).toBeNull();
    expect(resolveField(modified.input, { monaco: true })).toBeNull();
  });

  it("Monaco's rename input stays a Single-line Field holding its own text, and the page world is not asked", () => {
    const { element } = codeInput();
    const rename = document.createElement("input");
    rename.className = "rename-input";
    rename.value = "add";
    element.appendChild(rename);
    const seen = standInMonaco([[element, {}]]);
    const resolved = resolveField(rename, { monaco: true });
    expect(resolved?.element).toBe(rename);
    expect(resolved?.singleLine).toBe(true);
    expect(resolved!.create().getValue()).toBe("add");
    expect(seen.asked).toBe(0);
  });
});
