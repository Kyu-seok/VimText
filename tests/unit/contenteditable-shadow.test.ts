import { describe, it, expect, afterEach } from "vitest";
import { Sessions } from "../../src/content/Sessions";
import {
  activeHost,
  blockTexts,
  editableHost,
  selectedText,
  selectionOf,
  THREE_LINES,
  typeNatively,
} from "./contenteditable";
import { settledKeyDriver } from "./keys";
import { hostCount, keydown as keydownOn, settle, statusText } from "./dom";
import { controlledPort, settingsFor } from "./settings-port";

/**
 * A contenteditable host inside an open shadow root (#50), as a web component
 * holds its editor: the tracer-bullet cases of #44 through a Session, observed
 * through the shadow root's own selection (the document's is retargeted to
 * the shadow host and does not reach inside).
 */

let current: ReturnType<typeof activeHost> | null = null;
let component: HTMLElement | null = null;
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  current?.destroy();
  current = null;
  component?.remove();
  component = null;
});

const { keydown, keys } = settledKeyDriver(() => current!.session);

/** A Session on a host in a fresh open shadow root, focused with the caret at its start. */
function open(html = THREE_LINES) {
  component = document.createElement("div");
  document.body.appendChild(component);
  const root = component.attachShadow({ mode: "open" });
  current = activeHost(html, { parent: root });
  return { ...current, root };
}

describe("a contenteditable host in an open shadow root", () => {
  it("the Normal cursor is the selection of the character under it, inside the shadow tree", async () => {
    const { root } = open();
    expect(selectedText(root)).toBe("t");
    await keys("w");
    expect(selectedText(root)).toBe("q");
    await keys("j");
    expect(selectedText(root)).toBe("s");
  });

  it("reads a caret the page put inside the shadow tree", async () => {
    const { host, field, root } = open();
    const text = host.children[1]!.firstChild!;
    selectionOf(root).setBaseAndExtent(text, 2, text, 2);
    expect(field.getSelection()).toEqual({ anchor: 22, head: 22 });
  });

  it("Visual selects inside the shadow tree", async () => {
    const { root } = open();
    await keys("ve");
    expect(selectedText(root)).toBe("the");
  });

  it("x dw cw dd o and u edit the blocks through editing commands", async () => {
    const { host, field } = open();
    const original = field.getValue();
    await keys("x");
    expect(blockTexts(host)[0]).toBe("he quick brown fox");
    await keys("dw");
    expect(blockTexts(host)[0]).toBe("quick brown fox");
    await keys("cw");
    typeNatively("slow");
    await keydown("Escape");
    expect(blockTexts(host)[0]).toBe("slow brown fox");
    await keys("jdd");
    expect(blockTexts(host)).toEqual(["slow brown fox", "third line here"]);
    await keys("o");
    typeNatively("new");
    await keydown("Escape");
    expect(blockTexts(host)).toEqual(["slow brown fox", "third line here", "new"]);
    await keys("uuuuu");
    expect(field.getValue()).toBe(original);
  });

  it("typing in Insert re-projects the host", async () => {
    const { host } = open();
    await keys("A");
    typeNatively("!");
    await keydown("Escape");
    await keys("x");
    expect(blockTexts(host)[0]).toBe("the quick brown fox");
  });
});

/** A web component whose open shadow root holds a contenteditable editor. */
class ShadowEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }
}
customElements.define("vimtext-test-editor", ShadowEditor);

describe("a contenteditable host in a custom element, through the content entry", () => {
  async function activated() {
    const port = controlledPort();
    const sessions = new Sessions(document, port.port, location.origin);
    cleanups.push(() => sessions.destroy());
    port.arrive(settingsFor(null));
    await settle();
    component = document.createElement("vimtext-test-editor");
    document.body.appendChild(component);
    const host = editableHost("<p>one</p><p>two</p>", { parent: component.shadowRoot! });
    host.focus();
    selectionOf(component.shadowRoot!).collapse(host.firstChild!.firstChild!, 0);
    // A key dispatched inside the shadow tree reaches the document listener retargeted; composedPath finds the host.
    expect(keydownOn(host, "Escape").defaultPrevented).toBe(true);
    return { host, sessions };
  }

  it("Esc Activates on the host and keys inside the shadow tree reach its Session", async () => {
    const { host, sessions } = await activated();
    expect(statusText()).toContain("NORMAL");
    expect(sessions.focusedMode).toBe("normal");
    keydownOn(host.querySelector("p")!, "x");
    expect(blockTexts(host)).toEqual(["ne", "two"]);
  });

  it("removing the custom element disposes the Session", async () => {
    const { sessions } = await activated();
    expect(hostCount()).toBe(1);
    component!.remove();
    await settle();
    expect(hostCount()).toBe(0);
    expect(sessions.observing).toBe(false);
  });

  it("removing the host from inside the shadow root disposes the Session", async () => {
    const { host, sessions } = await activated();
    host.remove();
    await settle();
    expect(hostCount()).toBe(0);
    expect(sessions.observing).toBe(false);
  });
});
