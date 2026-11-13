import { describe, it, expect, afterEach } from "vitest";
import { project } from "../../src/field/projection";
import { editableHost } from "./contenteditable";

/**
 * The projection follows `innerText` (#45, DESIGN.md "contenteditable
 * Fields", _Projection_): each host is built from markup and the projection's
 * text compared with what Chrome's `innerText` reads of the same DOM. The
 * markup uses `<div>`s, not `<p>`s, where it compares with `innerText`: the
 * deliberate departures (one line per block, a block's trailing break) have
 * their own cases with the expected text written out.
 */

afterEach(() => {
  document.body.innerHTML = "";
});

function matchesInnerText(html: string, opts: Parameters<typeof editableHost>[1] = {}): string {
  const host = editableHost(html, opts);
  const text = project(host).text;
  expect(text, html).toBe(host.innerText);
  return text;
}

describe("projection matches innerText", () => {
  it("collapses runs of spaces and newlines in source HTML to one space", () => {
    expect(matchesInnerText("<div>a   b \n c</div>")).toBe("a b c");
    expect(matchesInnerText("<div>  a <b> b</b> </div>")).toBe("a b");
    expect(matchesInnerText("<div>a<b> </b> b</div><div>\tc\t</div>")).toBe("a b\nc");
  });

  it("drops whitespace between blocks and around a <br>", () => {
    expect(matchesInnerText("<div>a</div>\n  <div> b <br> c </div>\n")).toBe("a\nb\nc");
    expect(matchesInnerText("<ul>\n  <li>one</li>\n  <li>two</li>\n</ul>")).toBe("one\ntwo");
  });

  it("nested blocks, lists and inline formatting", () => {
    expect(
      matchesInnerText(
        "<div><div>one</div><div>t<b>w</b>o</div></div><ul><li>a <i>b<u>c</u></i></li><li><div>d</div></li></ul><ol><li>e</li></ol>",
      ),
    ).toBe("one\ntwo\na bc\nd\ne");
  });

  it("a \\n in white-space: pre* text is a line break", () => {
    expect(matchesInnerText("<pre>if (a) {\n  b();\n}</pre><div>after</div>")).toBe(
      "if (a) {\n  b();\n}\nafter",
    );
    expect(matchesInnerText('<div style="white-space:pre-wrap">a  b\n\n c</div>')).toBe("a  b\n\n c");
    expect(matchesInnerText('<div style="white-space:pre-line">a   b\n  c</div>')).toBe("a b\nc");
    expect(matchesInnerText("<div>x<pre>a\tb</pre>y</div>")).toBe("x\na\tb\ny");
  });

  it("table cells in a row are joined by a tab, rows are lines", () => {
    expect(matchesInnerText("<table><tr><td>a</td><td>b</td></tr><tr><td></td><td>d</td></tr></table>")).toBe(
      "a\tb\n\td",
    );
    expect(
      matchesInnerText(
        "<div>x</div><table>\n<tbody>\n<tr>\n<th> h1 </th>\n<th>h2</th>\n</tr>\n<tr><td>c <b>1</b></td><td>c2</td></tr></tbody></table><div>y</div>",
      ),
    ).toBe("x\nh1\th2\nc 1\tc2\ny");
  });

  it("a plaintext-only host projects like a true one", () => {
    expect(
      matchesInnerText("<div>one</div><div>two<br>three</div>", { contenteditable: "plaintext-only" }),
    ).toBe("one\ntwo\nthree");
    // plaintext-only computes white-space: pre-wrap, so its spaces and newlines are kept.
    expect(matchesInnerText("a  b\nc", { contenteditable: "plaintext-only" })).toBe("a  b\nc");
  });
});

describe("projection departs from innerText where innerText departs from the rendering", () => {
  const text = (html: string) => project(editableHost(html)).text;

  it("one line per block: no blank line between <p>s or after a heading", () => {
    const host = editableHost("<h1>title</h1><p>one</p><p>two</p>");
    expect(host.innerText).toBe("title\n\none\n\ntwo");
    expect(project(host).text).toBe("title\none\ntwo");
  });

  it("a <br> before a nested block: alone on its line it is an empty line, ending a line of text it is no line (#67)", () => {
    // innerText adds a line for each (Chromium facts, "innerText as the oracle").
    expect(editableHost("one<div><br><div>two</div></div>").innerText).toBe("one\n\n\ntwo");
    expect(text("one<div><br><div>two</div></div>")).toBe("one\n\ntwo");
    expect(text("<div><br><div>two</div></div>")).toBe("\ntwo");
    expect(text("<div>a<br><div>b</div></div>")).toBe("a\nb");
    expect(text("<div>x<br><br><div>b</div></div>")).toBe("x\n\nb");
  });

  it("a break that ends its block renders no line, a <br> or a preserved \\n alike", () => {
    expect(text("<div>a<br></div><div>b</div>")).toBe("a\nb");
    expect(text("<pre>a\n</pre><div>b</div>")).toBe("a\nb");
    expect(text("<pre>a\n\n</pre><div>b</div>")).toBe("a\n\nb");
  });
});

describe("projection offsets over collapsed and preserved whitespace", () => {
  const cases = [
    "<div>  a   b <b> c</b>  </div><div> d</div>",
    "<pre>x\n  y\n</pre><div>z</div>",
    '<div style="white-space:pre-line">a  \n  b</div>',
    "<table><tr><td> a </td><td></td><td>b</td></tr><tr><td>c</td></tr></table>",
  ];

  it.each(cases)("maps every offset to a DOM position and back: %s", (html) => {
    const host = editableHost(html);
    const p = project(host);
    for (let k = 0; k <= p.text.length; k++) {
      const { node, offset } = p.toDom(k);
      expect(host.contains(node), `offset ${k}`).toBe(true);
      expect(p.fromDom(node, offset), `offset ${k}`).toBe(k);
    }
  });

  it("a collapsed space's DOM range is the whole run it stands for", () => {
    const host = editableHost("<div>a \n  b</div>");
    const p = project(host);
    expect(p.text).toBe("a b");
    const range = document.createRange();
    const from = p.toDom(1);
    const to = p.toDom(2);
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    expect(range.toString()).toBe(" \n  ");
  });

  it("a point inside dropped or collapsed whitespace reads as the next character", () => {
    const host = editableHost("<div>  a   b</div>");
    const t = host.firstChild!.firstChild!;
    const p = project(host);
    expect(p.fromDom(t, 0)).toBe(0);
    expect(p.fromDom(t, 4)).toBe(2); // inside "   ": before "b"
  });
});
