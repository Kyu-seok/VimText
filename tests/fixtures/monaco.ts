// E2E fixture: the pinned Monaco build (monaco-editor 0.55.1, the version
// code-bite ran when #113 probed it), bundled by tools/build.mjs into
// tests/fixtures/monaco.js and .css (both gitignored) and loaded by
// monaco.html. The page exposes `window.monaco` as LeetCode and CodeBite do:
// VimText's page-world script finds the editor through it and nothing else
// (ADR 0010), and so do the e2e helpers (tests/e2e/monaco.ts).
// The page's query string picks the editor a spec needs:
//   ?editContext=1  Monaco takes input through an EditContext (focus on
//                   div.native-edit-context) instead of textarea.inputarea
//   ?expose=0       `window.monaco` is not set, as on a site that bundles
//                   Monaco privately (NeetCode)
//   ?readOnly=1     the editor is read-only
//   ?diff=1         a diff editor instead of a code editor
//   ?eol=crlf       the model's line ends are \r\n
//   ?second=1       a second code editor in #second, holding SECOND_TEXT
//   ?oneLine=1      a writable plaintext editor of one line in #one-line,
//                   holding ONE_LINE_TEXT, as leetcode has beside its code editor (#113)
//   ?nested=1       a code editor holding SECOND_TEXT inside the first one's element, in
//                   an overlay widget, as Monaco nests a peek view's editor in the editor
//                   it peeks from (EmbeddedCodeEditorWidget), registered after it
// The extra editors come after the first in `monaco.editor.getEditors()`, in that order.
// What the e2e specs rely on:
//   #editor                the element the editor is created in
//   window.pageKeys        the keys of the `keydown` events that reached the page (a listener on #editor)
//   document.documentElement[data-monaco="ready"]  set once the editor exists
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
// Every editor feature (suggestions, find, bracket closing), and one language for them to work on.
import "monaco-editor/esm/vs/editor/edcore.main.js";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js";
import { MONACO_TEXT, ONE_LINE_TEXT, SECOND_TEXT } from "./monaco-text";

const params = new URLSearchParams(location.search);
const on = (name: string) => params.get(name) === "1";

// The editor's own worker, a file of its own beside this bundle.
Object.assign(self, { MonacoEnvironment: { getWorker: () => new Worker("monaco.worker.js") } });

const container = document.getElementById("editor")!;
const pageKeys: string[] = [];
container.addEventListener("keydown", (e) => pageKeys.push(e.key));

const options = {
  language: "javascript",
  automaticLayout: false,
  minimap: { enabled: false },
  editContext: on("editContext"),
  readOnly: on("readOnly"),
};
const text = params.get("eol") === "crlf" ? MONACO_TEXT.replace(/\n/g, "\r\n") : MONACO_TEXT;
if (on("diff")) {
  const diff = monaco.editor.createDiffEditor(container, options);
  diff.setModel({
    original: monaco.editor.createModel(text, "javascript"),
    modified: monaco.editor.createModel(text, "javascript"),
  });
} else {
  monaco.editor.create(container, { ...options, value: text });
}

/** A container for one more editor, under the first. */
function extraContainer(id: string, height: number): HTMLElement {
  const el = document.createElement("div");
  el.id = id;
  el.style.cssText = `width: 640px; height: ${height}px; border: 1px solid #888; margin-top: 12px`;
  container.after(el);
  return el;
}
// Appended in reverse, so #second sits above #one-line.
const oneLine = on("oneLine") ? extraContainer("one-line", 24) : null;
if (on("second")) monaco.editor.create(extraContainer("second", 120), { ...options, value: SECOND_TEXT });
if (oneLine) {
  monaco.editor.create(oneLine, {
    ...options,
    language: "plaintext",
    value: ONE_LINE_TEXT,
    lineNumbers: "off",
    scrollbar: { vertical: "hidden", horizontal: "hidden" },
  });
}

if (on("nested")) {
  const outer = monaco.editor.getEditors()[0]!;
  const host = document.createElement("div");
  host.id = "nested";
  host.style.cssText = "width: 400px; height: 80px; border: 1px solid #888";
  outer.addOverlayWidget({
    getId: () => "fixture.nested",
    getDomNode: () => host,
    getPosition: () => ({ preference: monaco.editor.OverlayWidgetPositionPreference.BOTTOM_RIGHT_CORNER }),
  });
  monaco.editor.create(host, { ...options, value: SECOND_TEXT });
}

Object.assign(window, { pageKeys });
if (params.get("expose") !== "0") Object.assign(window, { monaco });
// The e2e helpers read the editor through this where `window.monaco` is withheld.
Object.assign(window, { fixtureMonaco: monaco });
document.documentElement.dataset.monaco = "ready";
