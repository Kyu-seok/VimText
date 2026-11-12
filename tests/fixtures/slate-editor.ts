// A Slate editor, the pinned build VimText's writes are proven on (#54):
// slate 0.147.4, slate-react 0.147.5, slate-history 0.144.0, rendered by the
// repo's React (19.3.0), with a bold run, a heading and a bulleted list.
// Slate takes its edits only from `beforeinput` and never reads the DOM back
// on desktop (docs/research/editor-write-paths.md, "Slate"), so its model is
// what the tests read, never the DOM. Shared by the unit suite (imported
// directly) and the e2e fixture (slate.ts, bundled by tools/build.mjs into
// slate.js). Written with createElement, no JSX, so the unit suite needs no
// JSX transform.
import { createElement as h, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createEditor, Element, Node, Text as SlateText, type BaseEditor, type Descendant } from "slate";
import {
  Editable,
  Slate,
  withReact,
  type ReactEditor,
  type RenderElementProps,
  type RenderLeafProps,
} from "slate-react";
import { withHistory, type HistoryEditor } from "slate-history";

type Block =
  | { type: "paragraph"; children: Text[] }
  | { type: "heading"; children: Text[] }
  | { type: "bulleted-list"; children: Block[] }
  | { type: "list-item"; children: Text[] };
type Text = { text: string; bold?: boolean };

declare module "slate" {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor & HistoryEditor;
    Element: Block;
    Text: Text;
  }
}

/** The document every test starts from. */
function initialValue(): Descendant[] {
  return [
    {
      type: "paragraph",
      children: [{ text: "the " }, { text: "quick brown", bold: true }, { text: " fox" }],
    },
    { type: "heading", children: [{ text: "a heading" }] },
    {
      type: "bulleted-list",
      children: [
        { type: "list-item", children: [{ text: "first item" }] },
        { type: "list-item", children: [{ text: "second item" }] },
      ],
    },
    { type: "paragraph", children: [{ text: "last line" }] },
  ];
}

function renderElement({ attributes, children, element }: RenderElementProps): ReactElement {
  const tag = { paragraph: "p", heading: "h1", "bulleted-list": "ul", "list-item": "li" }[element.type];
  return h(tag, attributes, children);
}

function renderLeaf({ attributes, children, leaf }: RenderLeafProps): ReactElement {
  return h("span", attributes, leaf.bold ? h("strong", null, children) : children);
}

export interface SlateFixture {
  editor: BaseEditor & ReactEditor & HistoryEditor;
  /** The editing host: Slate's `<div contenteditable>` inside `place`. */
  host: HTMLElement;
  unmount(): void;
}

/** Mounts the editor in `place`, rendered synchronously, so its host is there on return. */
export function mountSlate(place: HTMLElement): SlateFixture {
  const editor = withHistory(withReact(createEditor()));
  const root = createRoot(place);
  flushSync(() => {
    root.render(
      h(Slate, {
        editor,
        initialValue: initialValue(),
        children: h(Editable, { id: "editor", renderElement, renderLeaf, spellCheck: false }),
      }),
    );
  });
  const host = place.querySelector<HTMLElement>("[data-slate-editor]")!;
  return { editor, host, unmount: () => root.unmount() };
}

/** Slate's blocks, one per line: a list's items are lines of their own. */
function lineBlocks(editor: BaseEditor): Descendant[] {
  return editor.children.flatMap((block): Descendant[] =>
    Element.isElement(block) && block.type === "bulleted-list" ? block.children : [block],
  );
}

/** Slate's own text, one line per block. */
export function modelLines(editor: BaseEditor): string[] {
  return lineBlocks(editor).map((block) => Node.string(block));
}

/** The same lines with Slate's marks: bold as `<b>…</b>`, a heading prefixed `h1:`, a list item `li:`. */
export function describeDoc(editor: BaseEditor): string[] {
  return lineBlocks(editor).map((block) => {
    const marked = [...Node.texts(block)]
      .map(([leaf]) => (SlateText.isText(leaf) && leaf.bold && leaf.text ? `<b>${leaf.text}</b>` : leaf.text))
      .join("");
    const kind = Element.isElement(block) && block.type === "heading" ? "h1:" : "";
    return (Element.isElement(block) && block.type === "list-item" ? "li:" : kind) + marked;
  });
}
