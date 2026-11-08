import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Sessions, type PluginRegistry } from "../../src/content/Sessions";
import type { Settings, SitePolicy } from "../../src/settings/settings";
import { checkVimrc } from "../../src/engine/vimrc";
import { surround } from "../../src/plugins/surround";
import { keydown, keys, settle, statusText } from "./dom";
import { controlledPort, settingsFor } from "./settings-port";

/**
 * The vimrc is a Setting that every Activation re-runs (GLOSSARY.md
 * **vimrc**). Engine mappings are global per frame, so these tests drive the
 * content entry's class through the settings port, Activate twice in the same
 * frame with different vimrcs, and observe what the user sees: the Field's
 * value after the key that was (or was no longer) mapped.
 */

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

describe("Plugin bindings", () => {
  // A fake Plugin stands in at the registry: one binding, no typed sequences to hold.
  const plugins: PluginRegistry = {
    surround: {
      keys: [],
      define() {},
      bind: (engine) => engine.bindKey({ keys: "\\s", type: "keyToKey", toKeys: "dd" }),
    },
  };

  function withSurround(policy: SitePolicy | null, vimrc: string, enabled = true): Settings {
    return { ...settingsFor(policy, vimrc), plugins: { surround: enabled, targets: false } };
  }

  beforeEach(() => {
    sessions.destroy();
    sessions = new Sessions(document, port.port, location.origin, null, plugins);
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

  it("a disabled Plugin's mapping is not applied: \\ is swallowed as a beep and s is Vim's substitute", async () => {
    port.arrive(withSurround(null, "", false));
    await settle();
    activateAtStart();
    const backslash = keydown(ta, "\\");
    expect(backslash.defaultPrevented).toBe(true); // an unbound printable key: Vim beeps, the page never sees it
    expect(ta.value).toBe(TEXT);
    keys(ta, "s");
    expect(ta.value).toBe("he quick brown fox\njumps over");
  });
});

describe('the surround Plugin through the Settings (DESIGN.md "Settings": clear, bind Plugins, run the vimrc)', () => {
  const PARENS = "(the) quick\nsecond";

  function withSurround(policy: SitePolicy | null, vimrc: string, enabled: boolean): Settings {
    return { ...settingsFor(policy, vimrc), plugins: { surround: enabled, targets: false } };
  }

  beforeEach(() => {
    sessions.destroy();
    sessions = new Sessions(document, port.port, location.origin, null, { surround });
    ta.value = PARENS;
  });

  it("bindings are applied before the vimrc, so a vimrc mapping on a Plugin Key wins: nnoremap <SurroundDs> dd", async () => {
    port.arrive(withSurround(null, "nnoremap <SurroundDs> dd", true));
    await settle();
    activateAtStart();
    keys(ta, "ds(");
    expect(ta.value).toBe("second"); // the line went, not the parentheses
  });

  it("enabled, ds( deletes the parentheses; disabled at the next Activation, the same keys are the Baseline", async () => {
    port.arrive(withSurround(null, "", true));
    await settle();
    activateAtStart();
    keys(ta, "ds(");
    expect(ta.value).toBe("the quick\nsecond");

    ta.value = PARENS;
    port.change(withSurround("off", "", false));
    port.change(withSurround(null, "", false));
    activateAtStart();
    keys(ta, "ds(");
    expect(ta.value).toBe(PARENS); // d then s: no such command, the engine clears; ( is a motion
    keys(ta, "s");
    expect(ta.value).toBe("the) quick\nsecond");
    expect(statusText()).toContain("INSERT");
  });
});

describe("checkVimrc: what the options page shows under the text box", () => {
  it("reports a bad line by number with the engine's message, and nothing for the good ones", () => {
    const errors = checkVimrc('" comment\nnnoremap Y y$\n\n:notacommand foo\nset nosuchoption');
    expect(errors).toEqual([
      { line: 4, text: "notacommand foo", error: 'Not an editor command ":notacommand foo"' },
      // The engine reads `no` as the boolean prefix before it looks the option up.
      { line: 5, text: "set nosuchoption", error: "Unknown option: suchoption" },
    ]);
  });

  it("reports nothing for a clean vimrc", () => {
    expect(checkVimrc("nnoremap Y y$\nset textwidth=80\nnnoremap \\x dd")).toEqual([]);
  });

  it("reports an error that the engine raises on a later line only against that line", () => {
    expect(checkVimrc("nnoremap Y y$\nunmap Q").map((e) => e.line)).toEqual([2]);
  });
});
