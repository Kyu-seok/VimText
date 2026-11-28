import { describe, it, expect, afterEach } from "vitest";
import { ChangeSet } from "@codemirror/state";
import { resolveField } from "../../src/field/resolve";
import { MAX_ANSWER_LENGTH } from "../../src/field/monacoAdapter";
import { MONACO_ANSWER, MONACO_REQUEST, type MonacoRequest } from "../../src/field/monacoProtocol";
import { Session } from "../../src/bridge/Session";
import { keyDriver } from "./keys";

/**
 * The content script's side of the Monaco Field (ADR 0010), with a stand-in
 * for the page world: a listener in this page that answers VimText's request
 * event as the page-world script does, or as a hostile page might. What is
 * observed is what `resolveField` decides and what the Field it makes reads
 * and sends. The real page-world script and the real Monaco are the e2e
 * suite's (tests/e2e/monaco.spec.ts).
 */

let stopPageWorld: () => void = () => {};

afterEach(() => {
  stopPageWorld();
  stopPageWorld = () => {};
  document.body.innerHTML = "";
});

/**
 * Stands in for the page world: each request is answered with the `detail`s
 * `answers` returns for it, one event each. Returns the requests seen.
 */
function pageWorld(answers: (request: MonacoRequest) => unknown[]): MonacoRequest[] {
  const seen: MonacoRequest[] = [];
  const listener = (e: Event) => {
    const request = JSON.parse((e as CustomEvent<string>).detail) as MonacoRequest;
    seen.push(request);
    for (const detail of answers(request)) {
      e.composedPath()[0]!.dispatchEvent(new CustomEvent(MONACO_ANSWER, { detail }));
    }
  };
  window.addEventListener(MONACO_REQUEST, listener, true);
  stopPageWorld = () => window.removeEventListener(MONACO_REQUEST, listener, true);
  return seen;
}

/** A page world holding `text` with a caret at `caret`, answering as VimText's script does. */
function honestPageWorld(text: string, caret = 0): MonacoRequest[] {
  return pageWorld((request) => [
    JSON.stringify(
      request.op === "read" ? { anchor: caret, head: caret, text } : { anchor: caret, head: caret },
    ),
  ]);
}

/** Monaco's markup around a textarea of class `cls`, as far as `resolveField` looks at it. */
function monacoTextarea(cls = "inputarea"): HTMLTextAreaElement {
  const editor = document.createElement("div");
  editor.className = "monaco-editor";
  const ta = document.createElement("textarea");
  ta.className = cls;
  editor.appendChild(ta);
  document.body.appendChild(editor);
  return ta;
}

/** Monaco's markup around its EditContext input (`div.native-edit-context`, focusable, not contenteditable). */
function monacoEditContextInput(): HTMLElement {
  const editor = document.createElement("div");
  editor.className = "monaco-editor";
  const input = document.createElement("div");
  input.className = "native-edit-context";
  input.tabIndex = 0;
  editor.appendChild(input);
  document.body.appendChild(editor);
  return input;
}

describe("resolveField on Monaco's input, the setting on", () => {
  it("is a multi-line Monaco Field on the input where the page world answers for its editor", () => {
    honestPageWorld("one\ntwo", 4);
    const ta = monacoTextarea();
    const resolved = resolveField(ta, { monaco: true });
    expect(resolved?.element).toBe(ta);
    expect(resolved?.singleLine).toBe(false);
    const field = resolved!.create();
    expect(field.getValue()).toBe("one\ntwo");
    expect(field.getSelection()).toEqual({ anchor: 4, head: 4 });
  });

  it("is a Monaco Field inside an open shadow root too", () => {
    honestPageWorld("one");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<div class="monaco-editor"><textarea class="inputarea"></textarea></div>';
    const ta = root.querySelector("textarea")!;
    expect(resolveField(ta, { monaco: true })?.create().getValue()).toBe("one");
  });

  it("is not a Field where nothing answers: no page-world script, no window.monaco, no writable editor", () => {
    expect(resolveField(monacoTextarea(), { monaco: true })).toBeNull();
  });

  it("is a multi-line Monaco Field on the EditContext input where the page world answers for its editor", () => {
    honestPageWorld("one\ntwo", 4);
    const input = monacoEditContextInput();
    const resolved = resolveField(input, { monaco: true });
    expect(resolved?.element).toBe(input);
    expect(resolved?.singleLine).toBe(false);
    const field = resolved!.create();
    expect(field.getValue()).toBe("one\ntwo");
    expect(field.getSelection()).toEqual({ anchor: 4, head: 4 });
  });

  it("the EditContext input is not a Field where nothing answers", () => {
    expect(resolveField(monacoEditContextInput(), { monaco: true })).toBeNull();
  });

  it("a div with the EditContext input's class outside a Monaco editor is not a Field, and the page world is not asked", () => {
    const seen = honestPageWorld("one");
    const div = document.createElement("div");
    div.className = "native-edit-context";
    document.body.appendChild(div);
    expect(resolveField(div, { monaco: true })).toBeNull();
    expect(seen).toEqual([]);
  });

  it("the EditContext input's textarea is not a Field", () => {
    honestPageWorld("one");
    expect(resolveField(monacoTextarea("ime-text-area"), { monaco: true })).toBeNull();
  });

  it("Monaco's find input, a textarea of another class, stays a textarea Field holding its own text", () => {
    const seen = honestPageWorld("the code");
    const find = monacoTextarea("input");
    find.value = "needle";
    const resolved = resolveField(find, { monaco: true });
    expect(resolved?.element).toBe(find);
    expect(resolved!.create().getValue()).toBe("needle");
    expect(seen).toEqual([]);
  });

  it("a plain textarea is a textarea Field, and the page world is not asked", () => {
    const seen = honestPageWorld("the code");
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    expect(resolveField(ta, { monaco: true })?.element).toBe(ta);
    expect(seen).toEqual([]);
  });
});

describe("resolveField on Monaco's input, the setting off", () => {
  it.each([{}, { monaco: false }])("is not a Field and the page world is not asked (%o)", (options) => {
    const seen = honestPageWorld("one");
    expect(resolveField(monacoTextarea(), options)).toBeNull();
    expect(seen).toEqual([]);
  });

  it.each([{}, { monaco: false }])(
    "the EditContext input is not a Field and the page world is not asked (%o)",
    (options) => {
      const seen = honestPageWorld("one");
      expect(resolveField(monacoEditContextInput(), options)).toBeNull();
      expect(seen).toEqual([]);
    },
  );
});

describe("an answer from the page world is untrusted", () => {
  const malformed: [string, unknown[]][] = [
    ["an object, not a JSON string", [{ anchor: 0, head: 0 }]],
    ["a string that is not JSON", ["{anchor"]],
    ["JSON null", ["null"]],
    ["a JSON array", ["[0,0]"]],
    ["no head", ['{"anchor":0}']],
    ["a negative offset", ['{"anchor":-1,"head":0}']],
    ["a fractional offset", ['{"anchor":0.5,"head":0}']],
    ["an offset as a string", ['{"anchor":"0","head":0}']],
    ["an offset past what a number counts exactly", ['{"anchor":1e300,"head":0}']],
    ["two answers to one request", ['{"anchor":0,"head":0}', '{"anchor":0,"head":0}']],
    ["an answer longer than the limit", [`{"anchor":0,"head":0${" ".repeat(MAX_ANSWER_LENGTH)}}`]],
  ];

  it.each(malformed)("Monaco's input is not a Field when the answer is %s", (_name, details) => {
    pageWorld(() => details);
    expect(resolveField(monacoTextarea(), { monaco: true })).toBeNull();
  });

  const badReads: [string, unknown][] = [
    ["no text", '{"anchor":0,"head":0}'],
    ["a text that is not a string", '{"anchor":0,"head":0,"text":["x"]}'],
    ["a selection outside the text", '{"anchor":0,"head":9,"text":"x"}'],
    [
      "a text longer than the limit",
      JSON.stringify({ anchor: 0, head: 0, text: "x".repeat(MAX_ANSWER_LENGTH) }),
    ],
    ["a count of flushes that is not a count", '{"anchor":0,"head":0,"text":"x","generation":"7"}'],
    ["a negative count of flushes", '{"anchor":0,"head":0,"text":"x","generation":-1}'],
  ];

  it.each(badReads)("a read answered with %s leaves the Field at the text it last read", (_name, detail) => {
    let bad = false;
    pageWorld((request) => [
      bad && request.op === "read"
        ? detail
        : JSON.stringify(
            request.op === "read" ? { anchor: 1, head: 1, text: "good" } : { anchor: 1, head: 1 },
          ),
    ]);
    const field = resolveField(monacoTextarea(), { monaco: true })!.create();
    expect(field.getValue()).toBe("good");
    bad = true;
    expect(field.getValue()).toBe("good");
  });

  it("a selection answered outside the text the Field read leaves the Field at the selection it last read", () => {
    let bad = false;
    pageWorld((request) => [
      JSON.stringify(
        request.op === "read"
          ? { anchor: 1, head: 1, text: "good" }
          : bad
            ? { anchor: 0, head: 1e6 }
            : { anchor: 2, head: 3 },
      ),
    ]);
    const field = resolveField(monacoTextarea(), { monaco: true })!.create();
    expect(field.getValue()).toBe("good");
    expect(field.getSelection()).toEqual({ anchor: 2, head: 3 });
    bad = true;
    expect(field.getSelection()).toEqual({ anchor: 2, head: 3 });
  });

  it("a page world whose selection answers lie outside the text does not stop the next Vim key editing it", () => {
    const ta = monacoTextarea();
    const state = { text: "0123456789" };
    pageWorld((request) => {
      if (request.op === "edit") {
        for (const { from, to, insert } of [...request.edits].reverse())
          state.text = state.text.slice(0, from) + insert + state.text.slice(to);
      }
      return [
        JSON.stringify(
          request.op === "read" ? { anchor: 0, head: 0, text: state.text } : { anchor: 0, head: 1e6 },
        ),
      ];
    });
    ta.focus();
    const session = new Session(resolveField(ta, { monaco: true })!.create(), { vimrc: "" });
    try {
      keyDriver(() => session).keys("x");
      expect(state.text).toBe("123456789");
    } finally {
      session.destroy();
    }
  });

  it("only the selection and the text are taken from an answer", () => {
    pageWorld((request) => [
      JSON.stringify({
        anchor: 0,
        head: 2,
        text: request.op === "read" ? "abc" : undefined,
        singleLine: true,
        element: "body",
        __proto__: { getValue: "x" },
      }),
    ]);
    const field = resolveField(monacoTextarea(), { monaco: true })!.create();
    expect(field.getValue()).toBe("abc");
    expect(field.getSelection()).toEqual({ anchor: 0, head: 2 });
    expect(field.singleLine).toBe(false);
  });
});

describe("the page's count of its flushes and language changes, as a Monaco Field reads it (#121)", () => {
  /** A page world whose `read` answers carry `state.generation`, when it is a number. */
  function countingPageWorld(state: { generation?: number }): void {
    pageWorld((request) => [
      JSON.stringify(
        request.op === "read"
          ? { anchor: 0, head: 0, text: "code", generation: state.generation }
          : { anchor: 0, head: 0 },
      ),
    ]);
  }

  it("the first count read is where the Field starts: nothing was replaced", () => {
    countingPageWorld({ generation: 5 });
    const field = resolveField(monacoTextarea(), { monaco: true })!.create();
    field.getValue();
    expect(field.takeDocumentReplaced!()).toBe(false);
  });

  it("a count that moved says the document was replaced, once, however many reads saw it", () => {
    const state = { generation: 0 };
    countingPageWorld(state);
    const field = resolveField(monacoTextarea(), { monaco: true })!.create();
    field.getValue();
    state.generation = 2;
    field.getValue();
    field.getValue();
    expect(field.takeDocumentReplaced!()).toBe(true);
    expect(field.takeDocumentReplaced!()).toBe(false);
    field.getValue();
    expect(field.takeDocumentReplaced!()).toBe(false);
  });

  it("a page world that sends no count never says so", () => {
    countingPageWorld({});
    const field = resolveField(monacoTextarea(), { monaco: true })!.create();
    field.getValue();
    field.getValue();
    expect(field.takeDocumentReplaced!()).toBe(false);
  });
});

describe("what a Monaco Field sends the page world", () => {
  it("a write is the mirror's changes as edits, in the old text's offsets, not the whole text", () => {
    const seen = honestPageWorld("one\ntwo\nthree");
    const field = resolveField(monacoTextarea(), { monaco: true })!.create();
    seen.length = 0;
    const changes = ChangeSet.of(
      [
        { from: 0, to: 1, insert: "O" },
        { from: 8, to: 13 },
      ],
      13,
    );
    void field.setValue("One\ntwo\n", changes);
    expect(seen.filter((r) => r.op === "edit")).toEqual([
      {
        op: "edit",
        edits: [
          { from: 0, to: 1, insert: "O" },
          { from: 8, to: 13, insert: "" },
        ],
      },
    ]);
  });

  it("a write without changes is the one span that differs", () => {
    const seen = honestPageWorld("one\ntwo\nthree");
    const field = resolveField(monacoTextarea(), { monaco: true })!.create();
    void field.setValue("one\nthree");
    expect(seen.filter((r) => r.op === "edit")).toEqual([
      { op: "edit", edits: [{ from: 5, to: 9, insert: "" }] },
    ]);
  });

  it("a write of the text the editor already holds sends no edit", () => {
    const seen = honestPageWorld("one");
    const field = resolveField(monacoTextarea(), { monaco: true })!.create();
    void field.setValue("one");
    expect(seen.some((r) => r.op === "edit")).toBe(false);
  });

  it("a selection is sent even when it is the one already there", () => {
    const seen = honestPageWorld("one", 1);
    const field = resolveField(monacoTextarea(), { monaco: true })!.create();
    field.setSelection(1, 1);
    expect(seen.at(-1)).toEqual({ op: "select", anchor: 1, head: 1 });
  });
});
