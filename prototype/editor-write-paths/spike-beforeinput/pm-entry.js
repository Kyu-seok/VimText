import { Schema, DOMParser } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { addListNodes, splitListItem } from "prosemirror-schema-list";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { history, undo, redo } from "prosemirror-history";
import { inputRules, InputRule } from "prosemirror-inputrules";
const schema = new Schema({ nodes: addListNodes(basicSchema.spec.nodes, "paragraph block*", "block"), marks: basicSchema.spec.marks });
window.mountPM = (place, html) => {
  const source = document.createElement("div"); source.innerHTML = html;
  const state = EditorState.create({ doc: DOMParser.fromSchema(schema).parse(source),
    plugins: [inputRules({ rules: [new InputRule(/--$/, "—")] }), keymap({ Enter: splitListItem(schema.nodes.list_item), "Mod-z": undo, "Shift-Mod-z": redo }), keymap(baseKeymap), history()] });
  const view = new EditorView(place, { state });
  return { view, undo: () => undo(view.state, view.dispatch) };
};
