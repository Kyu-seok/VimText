// E2E fixture: the pinned ProseMirror build (#46). Bundled by tools/build.mjs
// into tests/fixtures/prosemirror.js and .css (both gitignored) and loaded by
// prosemirror.html. The editor's document is parsed from <template id="source">.
// What the e2e specs rely on:
//   #editor .ProseMirror   the editing host (contenteditable Field under test)
//   window.pmDoc()         ProseMirror's document read back from the editor
//                          (describeDoc), not from the DOM
import { mountProseMirror, describeDoc } from "./prosemirror-editor";

const source = document.getElementById("source") as HTMLTemplateElement;
const view = mountProseMirror(document.getElementById("editor")!, source.innerHTML);
Object.assign(window, { pmDoc: () => describeDoc(view.state.doc) });
