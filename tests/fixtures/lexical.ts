// E2E fixture: the pinned Lexical 0.53.0 build (#53), with @lexical/rich-text,
// @lexical/list and @lexical/history. Bundled by tools/build.mjs into
// tests/fixtures/lexical.js (gitignored) and loaded by lexical.html. Lexical
// takes its edits from `beforeinput` and reverts structural DOM changes it did
// not make (docs/research/editor-write-paths.md, "Lexical"), so its model is
// what the e2e specs read back, never the DOM.
// What the e2e specs rely on:
//   #editor              the editing host (contenteditable Field under test)
//   window.modelText()   Lexical's own text, one line per block (a list item
//                        is a block), a decorator as U+FFFC
//   window.lexicalDoc()  the same lines with Lexical's formats: bold as
//                        <b>…</b>, a block kind as a prefix ("h1:", "bullet:")
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isDecoratorNode,
  $isElementNode,
  $isTextNode,
  createEditor,
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import {
  $createHeadingNode,
  $isHeadingNode,
  HeadingNode,
  QuoteNode,
  registerRichText,
} from "@lexical/rich-text";
import {
  $createListItemNode,
  $createListNode,
  $isListNode,
  ListItemNode,
  ListNode,
  registerList,
} from "@lexical/list";
import { createEmptyHistoryState, registerHistory } from "@lexical/history";

const DECORATOR = "￼";

type SerializedMention = Spread<{ name: string }, SerializedLexicalNode>;

/** An inline decorator: a mention chip, rendered non-editable by Lexical (an Atom to VimText). */
class MentionNode extends DecoratorNode<null> {
  __name: string;

  static override getType(): string {
    return "mention";
  }

  static override clone(node: MentionNode): MentionNode {
    return new MentionNode(node.__name, node.__key);
  }

  static override importJSON(json: SerializedMention): MentionNode {
    return new MentionNode(json.name);
  }

  constructor(name: string, key?: NodeKey) {
    super(key);
    this.__name = name;
  }

  override exportJSON(): SerializedMention {
    return { ...super.exportJSON(), name: this.__name };
  }

  override createDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "mention";
    span.textContent = `@${this.__name}`;
    return span;
  }

  override updateDOM(): false {
    return false;
  }

  override isInline(): true {
    return true;
  }

  override getTextContent(): string {
    return `@${this.__name}`;
  }

  override decorate(): null {
    return null;
  }
}

const editor = createEditor({
  namespace: "vimtext-fixture",
  nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, MentionNode],
  onError: (error) => {
    throw error;
  },
});
editor.setRootElement(document.getElementById("editor"));
registerRichText(editor);
registerList(editor);

// A bold run, a heading, a list and a decorator (an Atom).
editor.update(
  () => {
    const root = $getRoot();
    root.clear();
    const first = $createParagraphNode();
    first.append(
      $createTextNode("the "),
      $createTextNode("quick brown").toggleFormat("bold"),
      $createTextNode(" fox"),
    );
    const heading = $createHeadingNode("h1").append($createTextNode("a heading"));
    const list = $createListNode("bullet").append(
      $createListItemNode().append($createTextNode("first item")),
      $createListItemNode().append($createTextNode("second item")),
    );
    const cat = $createParagraphNode().append(
      $createTextNode("a cat "),
      new MentionNode("cat"),
      $createTextNode(" here"),
    );
    const last = $createParagraphNode().append($createTextNode("last line"));
    root.append(first, heading, list, cat, last);
  },
  { discrete: true },
);
// Registered after the setup, so the setup is not an undoable step.
registerHistory(editor, createEmptyHistoryState(), 1000);

interface Line {
  text: string;
  marked: string;
  block: string;
}

function inline(node: LexicalNode, line: Line): void {
  if ($isTextNode(node)) {
    const text = node.getTextContent();
    line.text += text;
    line.marked += node.hasFormat("bold") ? `<b>${text}</b>` : text;
  } else if ($isDecoratorNode(node)) {
    line.text += DECORATOR;
    line.marked += DECORATOR;
  } else if ($isElementNode(node)) {
    for (const child of node.getChildren()) inline(child, line);
  } else {
    const text = node.getTextContent();
    line.text += text;
    line.marked += text;
  }
}

/** Lexical's model, one entry per line: a list's items are lines of their own. */
function lines(): Line[] {
  return editor.getEditorState().read(() => {
    const out: Line[] = [];
    for (const block of $getRoot().getChildren()) {
      if ($isListNode(block)) {
        for (const item of block.getChildren()) {
          const line = { text: "", marked: "", block: block.getListType() };
          inline(item, line);
          out.push(line);
        }
        continue;
      }
      const line = { text: "", marked: "", block: $isHeadingNode(block) ? block.getTag() : "" };
      inline(block, line);
      out.push(line);
    }
    return out;
  });
}

Object.assign(window, {
  modelText: () => lines().map((l) => l.text),
  lexicalDoc: () => lines().map((l) => (l.block ? `${l.block}:${l.marked}` : l.marked)),
});
