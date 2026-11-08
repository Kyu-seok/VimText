import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Sessions, type PluginRegistry, type SettingsPort } from "../../src/content/Sessions";
import { DEFAULT_SETTINGS, type Settings, type SitePolicy } from "../../src/settings/settings";

/**
 * The vimrc is a Setting that every Activation re-runs (GLOSSARY.md
 * **vimrc**). Engine mappings are global per frame, so these tests drive the
 * content entry's class through the settings port, Activate twice in the same
 * frame with different vimrcs, and observe what the user sees: the Field's
 * value after the key that was (or was no longer) mapped.
 */

function settingsFor(policy: SitePolicy | null, vimrc = ""): Settings {
  return { ...DEFAULT_SETTINGS, vimrc, sites: policy ? { [location.origin]: policy } : {} };
}

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
    arrive: (s: Settings) => resolveLoad(s),
    change: (s: Settings) => handler?.(s),
  };
}

function statusText(): string {
  const host = document.querySelector("vimtext-status") as HTMLElement | null;
  const bar = host?.shadowRoot?.querySelector(".bar");
  return bar && host!.style.display !== "none" ? (bar.textContent ?? "") : "";
}

function keydown(el: Element, key: string): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true }));
}

function keys(el: Element, seq: string): void {
  for (const ch of seq) keydown(el, ch);
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await Promise.resolve();
}

const TEXT = "the quick brown fox\njumps over";

let sessions: Sessions;
let ta: HTMLTextAreaElement;
let port: ReturnType<typeof controlledPort>;

function makeTextarea(): HTMLTextAreaElement {
  const el = document.createElement("textarea");
  el.value = TEXT;
  el.style.cssText = "width:400px;height:120px;font:14px/1.4 monospace";
  document.body.appendChild(el);
  return el;
}

/** Activates `ta` from the start of its text with Esc (Site Policy "insert"). */
function activateAtStart(): void {
  ta.focus();
  ta.setSelectionRange(0, 0);
  keydown(ta, "Escape");
  expect(statusText()).toContain("NORMAL");
}

/** Disposes every Session by switching the Site off, then back to "insert" with `vimrc`. */
function replaceVimrc(vimrc: string): void {
  port.change(settingsFor("off"));
  port.change(settingsFor(null, vimrc));
}

beforeEach(() => {
  port = controlledPort();
  sessions = new Sessions(document, port.port, location.origin);
  ta = makeTextarea();
});

afterEach(() => {
  sessions.destroy();
  document.body.innerHTML = "";
});

describe("vimrc mappings replace rather than accumulate", () => {
  it("nnoremap Y y$ maps Y; once the vimrc is saved without it, a fresh Activation no longer maps Y", async () => {
    port.arrive(settingsFor(null, "nnoremap Y y$"));
    await settle();
    activateAtStart();
    keys(ta, "wYP");
    expect(ta.value).toBe("the quick brown foxquick brown fox\njumps over");

    ta.value = TEXT;
    replaceVimrc("");
    activateAtStart();
    keys(ta, "wYP"); // Y is Vim's own yank-line again: P puts the line above
    expect(ta.value).toBe("the quick brown fox\nthe quick brown fox\njumps over");
  });
});

describe("Plugin mappings", () => {
  // No Plugin exists yet (M3 part 2); a fake one stands in at the hook.
  const plugins: PluginRegistry = { surround: (ex) => ex("nnoremap \\s dd") };

  function withSurround(policy: SitePolicy | null, vimrc: string, enabled = true): Settings {
    return { ...settingsFor(policy, vimrc), plugins: { surround: enabled, targets: false } };
  }

  beforeEach(() => {
    sessions.destroy();
    sessions = new Sessions(document, port.port, location.origin, plugins);
  });

  it("an enabled Plugin's mapping survives a vimrc change, while the dropped vimrc mapping does not", async () => {
    port.arrive(withSurround(null, "nnoremap Y y$"));
    await settle();
    activateAtStart();
    keys(ta, "\\s");
    expect(ta.value).toBe("jumps over");

    ta.value = TEXT;
    port.change(withSurround("off", ""));
    port.change(withSurround(null, ""));
    activateAtStart();
    keys(ta, "\\s");
    expect(ta.value).toBe("jumps over");
    ta.value = TEXT;
    activateAtStart();
    keys(ta, "wYP");
    expect(ta.value).toBe("the quick brown fox\nthe quick brown fox\njumps over");
  });

  it("a disabled Plugin's mapping is not applied: \\ beeps and s is Vim's substitute", async () => {
    port.arrive(withSurround(null, "", false));
    await settle();
    activateAtStart();
    keys(ta, "\\s");
    expect(ta.value).toBe("he quick brown fox\njumps over");
  });
});
