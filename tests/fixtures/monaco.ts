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
// What the e2e specs rely on:
//   #editor                the element the editor is created in
//   window.pageKeys        the keys of the `keydown` events that reached the page (a listener on #editor)
//   document.documentElement[data-monaco="ready"]  set once the editor exists
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
// Every editor feature (suggestions, find, bracket closing), and one language for them to work on.
import "monaco-editor/esm/vs/editor/edcore.main.js";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js";
import { MONACO_TEXT } from "./monaco-text";

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

Object.assign(window, { pageKeys });
if (params.get("expose") !== "0") Object.assign(window, { monaco });
// The e2e helpers read the editor through this where `window.monaco` is withheld.
Object.assign(window, { fixtureMonaco: monaco });
document.documentElement.dataset.monaco = "ready";
