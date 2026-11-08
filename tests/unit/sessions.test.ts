import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Sessions, type SettingsPort } from "../../src/content/Sessions";
import { DEFAULT_SETTINGS, type Settings, type SitePolicy } from "../../src/settings/settings";

/**
 * The Site Policy is unknown until settings arrive (DESIGN.md "Settings").
 * These tests drive the content entry's class through the settings port with
 * a load the test resolves by hand, and observe what the user sees: the
 * Status Line on the page and the Field's value.
 */

/** Settings with this origin's Site Policy set; `null` leaves the origin unknown ("insert"). */
function settingsFor(policy: SitePolicy | null, vimrc = ""): Settings {
  return { ...DEFAULT_SETTINGS, vimrc, sites: policy ? { [location.origin]: policy } : {} };
}

/** A settings port whose load and later deliveries the test controls. */
function controlledPort() {
  let resolveLoad: (s: Settings) => void = () => {};
  let handler: ((s: Settings) => void) | null = null;
  const port: SettingsPort = {
    load: () => new Promise<Settings>((r) => (resolveLoad = r)),
    watch: (h) => {
      handler = h;
      return () => (handler = null);
    },
  };
  return {
    port,
    /** The storage read completes. */
    arrive: (s: Settings) => resolveLoad(s),
    /** A later change, as the popup or options page would make. */
    change: (s: Settings) => handler?.(s),
  };
}

/** What the user sees on the one Status Line host, "" when none is shown. */
function statusText(): string {
  const host = document.querySelector("vimtext-status") as HTMLElement | null;
  const bar = host?.shadowRoot?.querySelector(".bar");
  return bar && host!.style.display !== "none" ? (bar.textContent ?? "") : "";
}

function hostCount(): number {
  return document.querySelectorAll("vimtext-status").length;
}

function keydown(el: Element, key: string, init: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true, ...init });
  el.dispatchEvent(e);
  return e;
}

/** Enough turns of the microtask queue for a resolved load to be handled. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await Promise.resolve();
}

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

beforeEach(() => {
  port = controlledPort();
  sessions = new Sessions(document, port.port);
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
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    const inner = document.createElement("textarea");
    inner.value = "inside";
    root.appendChild(inner);
    document.body.appendChild(host);
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
    const input = document.createElement("input");
    input.type = "text";
    input.value = "hello world";
    document.body.appendChild(input);
    port.arrive(settingsFor(null));
    await settle();
    input.focus();
    input.setSelectionRange(0, 0);
    expect(hostCount()).toBe(0);
    port.change(settingsFor("normal"));
    expect(statusText()).toContain("NORMAL");
    keydown(input, "x");
    expect(input.value).toBe("ello world");
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
