import { describe, it, expect, afterEach } from "vitest";
import type { EditorView } from "prosemirror-view";
import { Session } from "../../src/bridge/Session";
import { ContentEditableField } from "../../src/field/ContentEditableField";
import { mountProseMirror, describeDoc } from "../fixtures/prosemirror-editor";
import { caretAt, selectedText, typeNatively } from "./contenteditable";
import { keydown as dispatchKey, settle } from "./dom";
import { Sessions } from "../../src/content/Sessions";
import { controlledPort, settingsFor } from "./settings-port";

/**
 * VimText on a pinned ProseMirror build (#46): keys go in through a Session
 * as the content entry feeds them, one task apart as a person types (the
 * editor reads each DOM change in its MutationObserver callback), and the
 * tests read ProseMirror's own document, not the DOM.
 */

let current: { view: EditorView; field: ContentEditableField; session: Session; place: HTMLElement } | null =
  null;

afterEach(() => {
  if (current) {
    current.session.destroy();
    current.field.destroy();
    current.view.destroy();
    current.place.remove();
  }
  current = null;
  document.body.innerHTML = "";
});

function open(html: string) {
  const place = document.createElement("div");
  place.style.cssText = "width:480px;font:14px/20px monospace";
  document.body.appendChild(place);
  const view = mountProseMirror(place, html);
  const host = view.dom as HTMLElement;
  host.focus();
  caretAt(host.querySelector("p")!.firstChild ?? host, 0);
  const field = new ContentEditableField(host);
  const session = new Session(field, { vimrc: "" });
  current = { view, field, session, place };
  return current;
}

/** Each key once the previous one's write has settled and the editor's MutationObserver has read it. */
async function keys(seq: string, init: Partial<KeyboardEventInit> = {}): Promise<void> {
  for (const key of seq) await keydown(key, init);
}

async function keydown(key: string, init: Partial<KeyboardEventInit> = {}): Promise<KeyboardEvent> {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true, ...init });
  current!.session.handleKeydown(e);
  await current!.session.settled();
  await settle();
  return e;
}

/** Native typing in Insert mode, then the turn in which ProseMirror reads it. */
async function type(text: string): Promise<void> {
  typeNatively(text);
  await settle();
}

const doc = () => describeDoc(current!.view.state.doc);

describe("Normal-mode edits keep ProseMirror's marks", () => {
  it("x inside a bold run keeps the rest bold", async () => {
    open("<p>the <strong>quick brown</strong> fox</p><p>second line</p>");
    await keys("wx");
    expect(doc()).toEqual(["the <b>uick brown</b> fox", "second line"]);
    expect(current!.field.getValue()).toBe("the uick brown fox\nsecond line");
    expect(selectedText()).toBe("u");
  });

  it("dw and cw inside a bold run keep the rest bold", async () => {
    open("<p>the <strong>quick brown lazy dog</strong> fox</p>");
    await keys("wwdw");
    expect(doc()).toEqual(["the <b>quick lazy dog</b> fox"]);
    await keys("cw");
    await type("slow");
    await keydown("Escape");
    expect(doc()).toEqual(["the <b>quick slow dog</b> fox"]);
  });

  it("cw on the last word of a bold run leaves the plain space after it plain", async () => {
    open("<p>the <strong>quick brown</strong> fox</p>");
    await keys("wwcw");
    await type("lazy");
    await keydown("Escape");
    expect(doc()).toEqual(["the <b>quick lazy</b> fox"]);
  });

  it("across a bold boundary the surviving text keeps its marks", async () => {
    open("<p>the qu<strong>ick brown</strong> <em>fox</em> jumps</p>");
    await keys("wdw");
    expect(doc()).toEqual(["the <b>brown</b> <i>fox</i> jumps"]);
    await keys("wdw");
    expect(doc()).toEqual(["the <b>brown</b> jumps"]);
    await keys("0wx");
    expect(doc()).toEqual(["the <b>rown</b> jumps"]);
  });

  it("a link keeps its href through x", async () => {
    open('<p>see <a href="https://example.com/">the docs</a> here</p>');
    await keys("wx");
    expect(doc()).toEqual(["see <a>he docs</a> here"]);
    const mark = current!.view.state.doc.firstChild!.child(1).marks[0]!;
    expect(mark.attrs.href).toBe("https://example.com/");
  });
});

const BLOCKS =
  "<p>the <strong>quick</strong> fox</p><ul><li><p>first <em>item</em></p></li><li><p>second item</p></li></ul><p>last line</p>";

describe("line edits split and merge ProseMirror's blocks", () => {
  it("the projection reads one line per block", () => {
    const { field } = open(BLOCKS);
    expect(field.getValue()).toBe("the quick fox\nfirst item\nsecond item\nlast line");
  });

  it("o opens a paragraph below, and in a list a list item", async () => {
    open(BLOCKS);
    await keys("o");
    await type("new para");
    await keydown("Escape");
    expect(doc()).toEqual([
      "the <b>quick</b> fox",
      "new para",
      "ul[li[first <i>item</i>],li[second item]]",
      "last line",
    ]);
    await keys("jo");
    await type("new item");
    await keydown("Escape");
    expect(doc()).toEqual([
      "the <b>quick</b> fox",
      "new para",
      "ul[li[first <i>item</i>],li[new item],li[second item]]",
      "last line",
    ]);
  });

  it("dd removes a paragraph and a list item", async () => {
    open(BLOCKS);
    await keys("jdd");
    expect(doc()).toEqual(["the <b>quick</b> fox", "ul[li[second item]]", "last line"]);
    await keys("ggdd");
    expect(doc()).toEqual(["ul[li[second item]]", "last line"]);
  });

  it("dd on the last list item leaves the paragraph below outside the list", async () => {
    open(BLOCKS);
    await keys("jjdd");
    expect(doc()).toEqual(["the <b>quick</b> fox", "ul[li[first <i>item</i>]]", "last line"]);
  });

  it("a linewise p adds a block below, in a list a list item", async () => {
    open(BLOCKS);
    await keys("Gyykkp");
    expect(doc()).toEqual([
      "the <b>quick</b> fox",
      "ul[li[first <i>item</i>],li[last line],li[second item]]",
      "last line",
    ]);
  });

  it("J joins a list item with the next item, a paragraph with the next block", async () => {
    open(BLOCKS);
    // The joining space is typed after "item", so it takes the italic as typing there would.
    await keys("jJ");
    expect(doc()).toEqual(["the <b>quick</b> fox", "ul[li[first <i>item </i>second item]]", "last line"]);
    await keys("ggJ");
    expect(doc()).toEqual(["the <b>quick</b> fox first <i>item </i>second item", "last line"]);
  });
});

/** ProseMirror's document as plain text, one line per textblock: what `u` promises to restore. */
function docText(): string {
  const lines: string[] = [];
  current!.view.state.doc.descendants((node) => {
    if (!node.isTextblock) return true;
    lines.push(node.textContent);
    return false;
  });
  return lines.join("\n");
}

describe("undo", () => {
  it("u walks back x, dd and o; ProseMirror's document holds the restored text", async () => {
    const { field } = open(BLOCKS);
    const original = field.getValue();
    await keys("wx");
    await keys("jdd");
    await keys("o");
    await type("added");
    await keydown("Escape");
    await keys("uuu");
    expect(field.getValue()).toBe(original);
    expect(docText()).toBe(original);
    await keydown("r", { ctrlKey: true });
    expect(docText()).toBe("the uick fox\nfirst item\nsecond item\nlast line");
  });

  it("Cmd+Z and Ctrl+Z in Normal are swallowed: ProseMirror's own history never runs", async () => {
    const port = controlledPort();
    const sessions = new Sessions(document, port.port, location.origin);
    port.arrive(settingsFor(null));
    await settle();
    const place = document.createElement("div");
    document.body.appendChild(place);
    const view = mountProseMirror(place, BLOCKS);
    try {
      view.dom.focus();
      caretAt(view.dom.querySelector("p")!.firstChild!, 0);
      dispatchKey(view.dom, "Escape");
      dispatchKey(view.dom, "x");
      // The write lands asynchronously (ADR 0008).
      await expect.poll(() => describeDoc(view.state.doc)[0]).toBe("he <b>quick</b> fox");
      const after = describeDoc(view.state.doc);
      for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
        expect(dispatchKey(view.dom, "z", mod).defaultPrevented).toBe(true);
        await settle();
      }
      expect(describeDoc(view.state.doc)).toEqual(after);
    } finally {
      sessions.destroy();
      view.destroy();
    }
  });
});

describe("ProseMirror's rewrites", () => {
  it("an input rule rewriting a write syncs into the mirror, joined to that change's undo step", async () => {
    const { field } = open("<p>wait-x <strong>moment</strong></p>");
    await keys("fx");
    await keys("r-");
    // The engine wrote "wait--"; ProseMirror's input rule made it an em dash.
    expect(describeDoc(current!.view.state.doc)).toEqual(["wait— <b>moment</b>"]);
    expect(field.getValue()).toBe("wait— moment");
    await keys("$x");
    expect(docText()).toBe("wait— momen");
    await keys("u");
    expect(docText()).toBe("wait— moment");
    await keys("u");
    expect(docText()).toBe("wait-x moment");
    expect(field.getValue()).toBe("wait-x moment");
  });
});
