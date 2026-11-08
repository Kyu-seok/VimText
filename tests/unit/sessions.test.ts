import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Sessions } from "../../src/content/Sessions";
import { DEFAULT_SETTINGS } from "../../src/settings/settings";
import { hostCount, keydown, settle, statusText } from "./dom";
import { controlledPort, settingsFor } from "./settings-port";

/**
 * The Site Policy is unknown until settings arrive (DESIGN.md "Settings").
 * These tests drive the content entry's class through the settings port with
 * a load the test resolves by hand, and observe what the user sees: the
 * Status Line on the page and the Field's value.
 *
 * Coverage (CODING_STANDARDS rule 5): an arrival only ever Activates into
 * Normal; a Session already in another Mode is left alone. Placements: a
 * textarea, a Single-line Field and a Field inside an open shadow root, each
 * on both the remembered-key path and the "normal" path.
 */

let sessions: Sessions;
let ta: HTMLTextAreaElement;
let port: ReturnType<typeof controlledPort>;

function makeTextarea(): HTMLTextAreaElement {
  const el = document.createElement("textarea");
  el.value = "the quick brown fox";
  el.style.cssText = "width:400px;height:120px;font:14px/1.4 monospace";
  document.body.appendChild(el);
  return el;
}

function makeSingleLine(): HTMLInputElement {
  const el = document.createElement("input");
  el.type = "text";
  el.value = "hello world";
  document.body.appendChild(el);
  el.setSelectionRange(0, 0);
  return el;
}

/** A textarea inside an open shadow root, as a web component would hold one. */
function makeShadowTextarea(): HTMLTextAreaElement {
  const host = document.createElement("div");
  const el = document.createElement("textarea");
  el.value = "inside";
  host.attachShadow({ mode: "open" }).appendChild(el);
  document.body.appendChild(host);
  return el;
}

beforeEach(() => {
  port = controlledPort();
  sessions = new Sessions(document, port.port, location.origin);
  ta = makeTextarea();
});

afterEach(() => {
  sessions.destroy();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Activation key before settings arrive", () => {
  it("Esc on a focused textarea is remembered: nothing until the load resolves, then NORMAL", async () => {
    ta.focus();
    const esc = keydown(ta, "Escape");
    expect(esc.defaultPrevented).toBe(false); // the page sees it, as on an "off" site
    expect(hostCount()).toBe(0);
    port.arrive(settingsFor(null));
    await settle();
    expect(statusText()).toContain("NORMAL");
  });

  it("is forgotten when that Field loses focus: Esc on one, focus moved to another, neither Activates", async () => {
    const other = makeTextarea();
    ta.focus();
    keydown(ta, "Escape");
    other.focus();
    port.arrive(settingsFor(null));
    await settle();
    expect(hostCount()).toBe(0);
  });

  it("survives keys typed between the Esc and the arrival", async () => {
    ta.focus();
    keydown(ta, "Escape");
    for (const ch of "abc") keydown(ta, ch);
    port.arrive(settingsFor(null));
    await settle();
    expect(statusText()).toContain("NORMAL");
  });

  it("is spent by the arrival: 'off' then a change to 'insert' leaves the Field inert", async () => {
    ta.focus();
    keydown(ta, "Escape");
    port.arrive(settingsFor("off"));
    await settle();
    port.change(settingsFor("insert"));
    expect(hostCount()).toBe(0);
  });

  it("is remembered for a Single-line Field too", async () => {
    const single = makeSingleLine();
    single.focus();
    keydown(single, "Escape");
    port.arrive(settingsFor(null));
    await settle();
    expect(statusText()).toContain("NORMAL");
    keydown(single, "x");
    expect(single.value).toBe("ello world");
  });

  it("is remembered for a Field inside an open shadow root too", async () => {
    const inner = makeShadowTextarea();
    inner.focus();
    keydown(inner, "Escape");
    port.arrive(settingsFor(null));
    await settle();
    expect(statusText()).toContain("NORMAL");
  });

  it("builds the Session with the settings that arrived: the vimrc applies", async () => {
    ta.focus();
    keydown(ta, "Escape");
    port.arrive(settingsFor(null, "nnoremap \\x dd"));
    await settle();
    expect(statusText()).toContain("NORMAL");
    keydown(ta, "\\");
    keydown(ta, "x");
    expect(ta.value).toBe("");
  });
});

describe("Settings arrival on a focused Field without an Activation key", () => {
  it("'normal' Activates it", async () => {
    ta.focus();
    port.arrive(settingsFor("normal"));
    await settle();
    expect(statusText()).toContain("NORMAL");
  });

  it("'insert' leaves it inert", async () => {
    ta.focus();
    port.arrive(settingsFor("insert"));
    await settle();
    expect(hostCount()).toBe(0);
  });

  it("'off' leaves it inert", async () => {
    ta.focus();
    port.arrive(settingsFor("off"));
    await settle();
    expect(hostCount()).toBe(0);
  });

  it("'normal' reaches a Field inside an open shadow root", async () => {
    const inner = makeShadowTextarea();
    inner.focus();
    port.arrive(settingsFor("normal"));
    await settle();
    expect(statusText()).toContain("NORMAL");
  });

  it("never Activates in a document that does not have focus", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    ta.focus();
    keydown(ta, "Escape");
    port.arrive(settingsFor("normal"));
    await settle();
    expect(hostCount()).toBe(0);
  });
});

describe("A later settings change", () => {
  it("switching this origin to 'normal' Activates the focused Single-line Field without refocusing", async () => {
    const single = makeSingleLine();
    port.arrive(settingsFor(null));
    await settle();
    single.focus();
    expect(hostCount()).toBe(0);
    port.change(settingsFor("normal"));
    expect(statusText()).toContain("NORMAL");
    keydown(single, "x");
    expect(single.value).toBe("ello world");
  });

  it("leaves a Field that already has a Session in its Mode: Insert stays Insert", async () => {
    port.arrive(settingsFor(null));
    await settle();
    ta.focus();
    keydown(ta, "Escape");
    keydown(ta, "i");
    expect(statusText()).toContain("INSERT");
    port.change(settingsFor("normal"));
    expect(statusText()).toContain("INSERT");
    expect(hostCount()).toBe(1);
  });

  it("switching this origin to 'off' disposes the existing Session", async () => {
    port.arrive(settingsFor(null));
    await settle();
    ta.focus();
    keydown(ta, "Escape");
    expect(statusText()).toContain("NORMAL");
    port.change(settingsFor("off"));
    expect(hostCount()).toBe(0);
    expect(keydown(ta, "Escape").defaultPrevented).toBe(false); // native again
    expect(hostCount()).toBe(0);
  });
});

describe("Once settings are known", () => {
  it("'insert' Activates on Esc at once, taking the key from the page", async () => {
    port.arrive(settingsFor(null));
    await settle();
    ta.focus();
    expect(keydown(ta, "Escape").defaultPrevented).toBe(true);
    expect(statusText()).toContain("NORMAL");
  });

  it("'off' leaves Esc to the page", async () => {
    port.arrive(settingsFor("off"));
    await settle();
    ta.focus();
    expect(keydown(ta, "Escape").defaultPrevented).toBe(false);
    expect(hostCount()).toBe(0);
  });
});

describe("Site keying", () => {
  // A frame's Sessions is built with the Site's origin (the top page's), which
  // need not be the document's own (ADR 0005).
  const site = "https://top.test";

  beforeEach(() => {
    sessions.destroy();
    sessions = new Sessions(document, port.port, site);
  });

  it("applies the policy stored under the Site origin, not the document's", async () => {
    ta.focus();
    port.arrive({ ...DEFAULT_SETTINGS, sites: { [site]: "normal" } });
    await settle();
    expect(statusText()).toContain("NORMAL");
  });

  it("ignores a policy stored under the document's own origin", async () => {
    ta.focus();
    port.arrive({ ...DEFAULT_SETTINGS, sites: { [location.origin]: "normal" } });
    await settle();
    expect(hostCount()).toBe(0);
  });
});
