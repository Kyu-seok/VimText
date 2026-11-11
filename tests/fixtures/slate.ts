// E2E fixture: the pinned Slate build (#54), mounted by slate-editor.ts.
// Bundled by tools/build.mjs into tests/fixtures/slate.js (gitignored) and
// loaded by slate.html. What the e2e specs rely on:
//   #editor                the editing host (contenteditable Field under test)
//   window.modelText()     Slate's own text, one line per block (a list item
//                          is a block), read from its model, never the DOM
//   window.slateDoc()      the same lines with Slate's marks: bold as
//                          <b>…</b>, "h1:" before a heading, "li:" before a
//                          list item
//   window.slateUndos()    how many entries Slate's own history holds
//   window.slateUndoAll()  runs Slate's own `editor.undo()` until its history
//                          is empty
import { mountSlate, modelLines, describeDoc } from "./slate-editor";

const { editor } = mountSlate(document.getElementById("place")!);
Object.assign(window, {
  modelText: () => modelLines(editor),
  slateDoc: () => describeDoc(editor),
  slateUndos: () => editor.history.undos.length,
  slateUndoAll: () => {
    while (editor.history.undos.length) editor.undo();
  },
});
