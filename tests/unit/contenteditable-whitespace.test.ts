import { describe, it, expect, afterEach } from "vitest";
import { activeHost, selectedText, typeNatively } from "./contenteditable";
import { settledKeyDriver } from "./keys";

/**
 * Edits where the projection is not one character per DOM character (#45):
 * a `\n` in `pre` text, the tab between table cells, collapsed whitespace in
 * source HTML. Keys go in through a Session; the tests observe the host's DOM
 * text, which must change at the cursor and nowhere else.
 */

let current: ReturnType<typeof activeHost> | null = null;

afterEach(() => {
  current?.destroy();
  current = null;
  document.body.innerHTML = "";
});

const { keydown, keys } = settledKeyDriver(() => current!.session);

function open(html: string) {
  current = activeHost(html);
  return current.host;
}

describe("editing inside a pre line", () => {
  it("x and cw change the characters at the cursor on the line the \\n starts", async () => {
    const host = open("<pre>if (a) {\n  b(c);\n}</pre>");
    await keys("jw");
    expect(selectedText()).toBe("b");
    await keys("x");
    expect(host.textContent).toBe("if (a) {\n  (c);\n}");
    await keys("$x");
    expect(host.textContent).toBe("if (a) {\n  (c)\n}");
    await keys("0wlcw");
    typeNatively("d");
    await keydown("Escape");
    expect(host.textContent).toBe("if (a) {\n  (d)\n}");
  });

  it("J joins two pre lines by removing the \\n", async () => {
    const host = open("<pre>one\ntwo\nthree</pre>");
    await keys("jJ");
    expect(current!.field.getValue()).toBe("one\ntwo three");
    expect(host.innerText).toBe("one\ntwo three");
  });
});

describe("editing inside a table cell", () => {
  const TABLE = "<table><tr><td>a1</td><td>b1</td></tr><tr><td>a2</td><td>b <i>two</i></td></tr></table>";
  // A space Chrome leaves at a cell's edge is U+00A0, the space it renders as.
  const cells = (host: HTMLElement) =>
    [...host.querySelectorAll("td")].map((td) => td.textContent!.replace(/ /g, " "));

  it("w crosses the tab into the next cell; x and cw edit that cell only", async () => {
    const host = open(TABLE);
    await keys("jw");
    expect(selectedText()).toBe("b");
    await keys("x");
    expect(cells(host)).toEqual(["a1", "b1", "a2", " two"]);
    await keys("wcw");
    typeNatively("2");
    await keydown("Escape");
    expect(cells(host)).toEqual(["a1", "b1", "a2", " 2"]);
    await keys("gg$x");
    expect(cells(host)).toEqual(["a1", "b", "a2", " 2"]);
  });
});

describe("editing after collapsed whitespace", () => {
  // An edit next to a space rewrites that space (keepAdjacentSpaces), so the
  // collapsed run it stood for becomes one space in the markup too: the
  // rendered text is the same.
  it("an edit after a collapsed run lands on the character the cursor shows", async () => {
    const host = open("<div>one   two \n three</div>");
    await keys("w");
    expect(selectedText()).toBe("t");
    await keys("x");
    expect(host.innerText).toBe("one wo three");
    await keys("wx");
    expect(host.innerText).toBe("one wo hree");
  });

  it("an edit away from a collapsed run leaves the run alone", async () => {
    const host = open("<div>one   two</div>");
    await keys("$x");
    expect(host.textContent).toBe("one   tw");
  });

  it("x on a collapsed space removes the whole run it stands for", async () => {
    const host = open("<div>one   two</div>");
    await keys("3l");
    // The selection's text is what renders: one space for the run.
    expect(selectedText()).toBe(" ");
    await keys("x");
    expect(host.textContent).toBe("onetwo");
  });

  it("dw over a collapsed run leaves one rendered space", async () => {
    const host = open("<div>  one   two  three  </div>");
    await keys("wdw");
    expect(current!.field.getValue()).toBe("one three");
    expect(host.innerText).toBe("one three");
  });
});
