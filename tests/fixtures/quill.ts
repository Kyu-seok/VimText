// E2E fixture: the pinned Quill 2.0.3 build (#55). Bundled by tools/build.mjs
// into tests/fixtures/quill.js and .css (both gitignored) and loaded by
// quill.html. Quill reads DOM changes through Parchment's MutationObserver
// (docs/research/editor-write-paths.md, "Quill"), so its model is what the
// e2e specs read back, never the DOM.
// What the e2e specs rely on:
//   #editor .ql-editor   the editing host (contenteditable Field under test)
//   window.modelText()   Quill's own text, one line per block, an embed as U+FFFC
//   window.quillDoc()    the same lines with Quill's formats: bold as <b>…</b>,
//                        a block format as a prefix ("h1:", "bullet:")
import Quill from "quill";
import "quill/dist/quill.core.css";

const EMBED = "￼";
const CAT = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='7' fill='orange'/></svg>",
)}`;

const quill = new Quill(document.getElementById("editor")!, {});
// A bold run, a header, a Quill 2 list (<ol><li data-list="bullet">) and an image embed (an Atom).
quill.setContents([
  { insert: "the " },
  { insert: "quick brown", attributes: { bold: true } },
  { insert: " fox\n" },
  { insert: "a heading" },
  { insert: "\n", attributes: { header: 1 } },
  { insert: "first item" },
  { insert: "\n", attributes: { list: "bullet" } },
  { insert: "second item" },
  { insert: "\n", attributes: { list: "bullet" } },
  { insert: "a cat " },
  { insert: { image: CAT } },
  { insert: " here\n" },
  { insert: "last line\n" },
]);
// The setup is not an undoable step.
quill.history.clear();

interface Line {
  text: string;
  marked: string;
  block: string;
}

/** Quill's Delta, split into its lines: a `\n` insert ends a line and carries the line's block format. */
function lines(): Line[] {
  const out: Line[] = [];
  let line: Line = { text: "", marked: "", block: "" };
  for (const op of quill.getContents().ops) {
    const attrs = op.attributes ?? {};
    if (typeof op.insert !== "string") {
      line.text += EMBED;
      line.marked += EMBED;
      continue;
    }
    const parts = op.insert.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) {
        const kind = attrs.header ? `h${String(attrs.header)}` : attrs.list ? String(attrs.list) : "";
        out.push({ ...line, block: kind });
        line = { text: "", marked: "", block: "" };
      }
      line.text += part;
      line.marked += part && attrs.bold ? `<b>${part}</b>` : part;
    });
  }
  return out;
}

Object.assign(window, {
  modelText: () => lines().map((l) => l.text),
  quillDoc: () => lines().map((l) => (l.block ? `${l.block}:${l.marked}` : l.marked)),
});
