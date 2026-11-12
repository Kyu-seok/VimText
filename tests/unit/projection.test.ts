import { describe, it, expect, afterEach } from "vitest";
import { project } from "../../src/field/projection";
import { editableHost } from "./contenteditable";

/**
 * The plain-text projection of a contenteditable host (DESIGN.md
 * "contenteditable Fields", _Projection_): one line per block, a `<br>` a line
 * break unless it is the trailing placeholder of its block, and every offset
 * mapped to a DOM position and back. Expected texts are what the page renders,
 * line by line.
 */

afterEach(() => {
  document.body.innerHTML = "";
});

const text = (html: string) => project(editableHost(html)).text;

describe("projection text", () => {
  it("is one line per block", () => {
    expect(text("<p>one</p><p>two</p><div>three</div>")).toBe("one\ntwo\nthree");
  });

  it("keeps inline formatting inside its line", () => {
    expect(text("<p>a <b>bold</b> and <i>it<u>al</u></i>ic</p><p>x</p>")).toBe("a bold and italic\nx");
  });

  it("breaks a line at a <br>", () => {
    expect(text("<p>one<br>two</p><p>three</p>")).toBe("one\ntwo\nthree");
  });

  it("an empty block is an empty line; its placeholder <br> is not a break", () => {
    expect(text("<p>one</p><p><br></p><p>three</p>")).toBe("one\n\nthree");
  });

  it("the trailing <br> of a block with text is a placeholder too", () => {
    expect(text("<p>one<br></p><p>two</p>")).toBe("one\ntwo");
    expect(text("<p>one<br><br></p><p>two</p>")).toBe("one\n\ntwo");
  });

  it("bare text and <br>s directly in the host", () => {
    expect(text("one<br>two<br>three")).toBe("one\ntwo\nthree");
    expect(text("one<div>two</div>three")).toBe("one\ntwo\nthree");
  });

  it("nested blocks give one line each, never an empty one between them", () => {
    expect(text("<div><p>one</p><p>two</p></div><ul><li>three</li><li>four</li></ul>")).toBe(
      "one\ntwo\nthree\nfour",
    );
  });

  it("an empty host is empty text", () => {
    expect(text("")).toBe("");
    expect(text("<p><br></p>")).toBe("");
  });

  // Slate holds an empty leaf's place with a U+FEFF before its placeholder <br>
  // (slate-react `ZeroWidthString`); innerText reads it, but it renders as
  // nothing and is not in the editor's text. Read as a character, a fast `o`
  // wrote it into Slate's model (#54).
  it("a zero-width no-break space is nothing: Slate's empty line is an empty line", () => {
    const empty = '<span data-slate-zero-width="n" data-slate-length="0">\ufeff<br></span>';
    expect(text(`<p>one</p><p><span>${empty}</span></p><p>three</p>`)).toBe("one\n\nthree");
    expect(text("<p>a\ufeffb\ufeff</p>")).toBe("ab");
  });

  it("skips what is not rendered", () => {
    expect(text('<p>one<span style="display:none">hidden</span></p><p style="display:none">x</p>')).toBe(
      "one",
    );
  });
});

describe("projection offsets", () => {
  it("maps every offset to a DOM position and back", () => {
    const host = editableHost("<p>ab<b>cd</b></p><p><br></p><p>e<br>f</p>");
    const p = project(host);
    expect(p.text).toBe("abcd\n\ne\nf");
    for (let k = 0; k <= p.text.length; k++) {
      const { node, offset } = p.toDom(k);
      expect(host.contains(node), `offset ${k}`).toBe(true);
      expect(p.fromDom(node, offset), `offset ${k}`).toBe(k);
    }
  });

  it("a character's DOM range holds exactly that character", () => {
    const host = editableHost("<p>ab<b>cd</b></p><p>e</p>");
    const p = project(host);
    const range = document.createRange();
    for (const k of [0, 1, 2, 3, 5]) {
      const a = p.toDom(k);
      const b = p.toDom(k + 1);
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset);
      expect(range.toString(), `char ${k}`).toBe(p.text[k]);
    }
  });

  it("maps around a zero-width no-break space as around nothing", () => {
    const host = editableHost("<p>a\ufeffb</p><p><span>\ufeff<br></span></p><p>c</p>");
    const p = project(host);
    expect(p.text).toBe("ab\n\nc");
    for (let k = 0; k <= p.text.length; k++) {
      const { node, offset } = p.toDom(k);
      expect(p.fromDom(node, offset), `offset ${k}`).toBe(k);
    }
  });

  it("the offset of an empty line is a position inside its block", () => {
    const host = editableHost("<p>a</p><p><br></p><p>b</p>");
    const { node, offset } = project(host).toDom(2);
    expect(node).toBe(host.children[1]);
    expect(offset).toBe(0);
  });

  it("a position between blocks maps to the line it belongs to", () => {
    const host = editableHost("<p>ab</p><p>cd</p>");
    const p = project(host);
    expect(p.fromDom(host.children[0]!, 1)).toBe(2); // after "ab", end of line 1
    expect(p.fromDom(host.children[1]!, 0)).toBe(3); // before "cd", start of line 2
    expect(p.fromDom(host, 0)).toBe(0);
    expect(p.fromDom(host, 2)).toBe(5);
  });
});
