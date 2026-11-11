// A ProseMirror editor, the pinned rich editor VimText's writes are proven on
// (#46): the basic schema (bold, italic, links) with lists, the stock keymaps
// (Enter splits a list item), history, and one input rule (`--` becomes an em
// dash) so the editor can rewrite a write the way a Controlled Field does.
// Shared by the unit suite (imported directly) and the e2e fixture
// (prosemirror.ts, bundled by tools/build.mjs into prosemirror.js).
import { Schema, DOMParser, type Node } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { addListNodes, splitListItem } from "prosemirror-schema-list";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { history, undo, redo } from "prosemirror-history";
import { inputRules, InputRule } from "prosemirror-inputrules";
import "prosemirror-view/style/prosemirror.css";

const schema = new Schema({
  nodes: addListNodes(basicSchema.spec.nodes, "paragraph block*", "block"),
  marks: basicSchema.spec.marks,
});

/** `--` typed becomes an em dash: ProseMirror's own rewrite of an edit. */
const emDash = new InputRule(/--$/, "—");

/**
 * Mounts an editor in `place` whose document is parsed from `html`. The
 * editing host is `view.dom` (a `.ProseMirror` div inside `place`).
 */
export function mountProseMirror(place: HTMLElement, html: string): EditorView {
  const source = document.createElement("div");
  source.innerHTML = html;
  const state = EditorState.create({
    doc: DOMParser.fromSchema(schema).parse(source),
    plugins: [
      inputRules({ rules: [emDash] }),
      keymap({
        Enter: splitListItem(schema.nodes.list_item!),
        "Mod-z": undo,
        "Shift-Mod-z": redo,
        "Mod-y": redo,
      }),
      keymap(baseKeymap),
      history(),
    ],
  });
  return new EditorView(place, { state });
}

const MARK_TAG: Record<string, string> = { strong: "b", em: "i", link: "a", code: "code" };
const BLOCK_TAG: Record<string, string> = { bullet_list: "ul", ordered_list: "ol", list_item: "li" };

/**
 * ProseMirror's document read back from the editor (not the DOM), one string
 * per top-level block: a paragraph is its text with marks as `<b>…</b>`,
 * `<i>…</i>`, `<a>…</a>`; a list is `ul[li[…],li[…]]`.
 */
export function describeDoc(doc: Node): string[] {
  const out: string[] = [];
  doc.forEach((block) => out.push(describeBlock(block)));
  return out;
}

/**
 * ProseMirror's own text, one line per textblock (a list item's paragraph is
 * a line), a non-text inline as U+FFFC: the `modelText()` every rich-editor
 * fixture exposes (#53).
 */
export function modelLines(doc: Node): string[] {
  const out: string[] = [];
  doc.descendants((node) => {
    if (!node.isTextblock) return true;
    let line = "";
    node.forEach((child) => (line += child.isText ? child.text! : "￼"));
    out.push(line);
    return false;
  });
  return out;
}

function describeBlock(node: Node): string {
  const kids: string[] = [];
  if (node.isTextblock) {
    node.forEach((child) => {
      let text = child.isText ? child.text! : child.type.name === "hard_break" ? "<br>" : "￼";
      for (const mark of [...child.marks].reverse()) {
        const tag = MARK_TAG[mark.type.name] ?? mark.type.name;
        text = `<${tag}>${text}</${tag}>`;
      }
      kids.push(text);
    });
    return node.type.name === "paragraph" ? kids.join("") : `${node.type.name}:${kids.join("")}`;
  }
  node.forEach((child) => kids.push(describeBlock(child)));
  return `${BLOCK_TAG[node.type.name] ?? node.type.name}[${kids.join(",")}]`;
}
