import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Sessions, type SettingsPort } from "../../src/content/Sessions";
import type { SessionStatePort } from "../../src/content/SessionStateSync";
import { DEFAULT_SETTINGS, type Settings } from "../../src/settings/settings";
import type { SessionState } from "../../src/engine/globalState";
import { keydown, keys, settle } from "./dom";

/**
 * Session State (DESIGN.md "Session State", GLOSSARY.md **Session State**):
 * registers, macros and history shared by every tab through session storage.
 * These tests drive the content entry's class with a fake storage port and
 * observe from outside (CODING_STANDARDS rule 6): keys in, what the port
 * received and the Field's value out. The format the port receives is the one
 * the chrome adapter stores, so it is pinned here without a browser.
 */

/** Settings whose load resolves at once, with this origin unknown ("insert"). */
function settledSettings(): SettingsPort {
  const s: Settings = { ...DEFAULT_SETTINGS };
  return { load: () => Promise.resolve(s), watch: () => () => {} };
}

/** A session-storage port the test controls: what was saved, and changes from other tabs. */
function fakeStorage(initial: SessionState | null = null, opts: { controlledLoad?: boolean } = {}) {
  const saved: SessionState[] = [];
  let handler: ((s: SessionState) => void) | null = null;
  let failSave = false;
  let resolveLoad: (s: SessionState | null) => void = () => {};
  let rejectLoad: (err: Error) => void = () => {};
  const port: SessionStatePort = {
    load: () =>
      opts.controlledLoad
        ? new Promise<SessionState | null>((resolve, reject) => {
            resolveLoad = resolve;
            rejectLoad = reject;
          })
        : Promise.resolve(initial),
    save: (s) => {
      if (failSave) return Promise.reject(new Error("QUOTA_BYTES quota exceeded"));
      saved.push(JSON.parse(JSON.stringify(s)) as SessionState);
      return Promise.resolve();
    },
    watch: (h) => {
      handler = h;
      return () => (handler = null);
    },
  };
  return {
    port,
    saved,
    /** The state another tab wrote, as the storage change would deliver it. */
    change: (s: SessionState) => handler?.(s),
    /** Every later save is rejected, as a quota error would. */
    rejectSaves: () => (failSave = true),
    /** The storage read completes (`controlledLoad` only). */
    loaded: (s: SessionState | null) => resolveLoad(s),
    /** The storage read fails, as it does before the service worker's grant. */
    loadFailed: () => rejectLoad(new Error("Access to storage is not allowed from this context")),
  };
}

/** The text in the command line (the `:` or `/` input the engine opens in the Status Line). */
function commandLineEnter(text: string): void {
  const input = document.querySelector("vimtext-status")!.shadowRoot!.querySelector("input")!;
  input.value = text;
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true, composed: true }),
  );
}

let sessions: Sessions;
let ta: HTMLTextAreaElement;
let storage: ReturnType<typeof fakeStorage>;

async function activated(
  initial: SessionState | null = null,
  opts: { controlledLoad?: boolean } = {},
): Promise<void> {
  storage = fakeStorage(initial, opts);
  sessions = new Sessions(document, settledSettings(), location.origin, storage.port);
  ta = document.createElement("textarea");
  ta.value = "the quick brown fox\njumps over the lazy dog";
  ta.style.cssText = "width:400px;height:120px;font:14px/1.4 monospace";
  document.body.appendChild(ta);
  ta.focus();
  ta.setSelectionRange(0, 0);
  await settle();
  keydown(ta, "Escape");
}

afterEach(() => {
  sessions.destroy();
  document.body.innerHTML = "";
});

describe("Session State is written after the key that changed it", () => {
  beforeEach(() => activated());

  it("a yank writes the unnamed and named registers", async () => {
    keys(ta, '"ayiw');
    await settle();
    const last = storage.saved.at(-1)!;
    expect(last.registers["a"]).toMatchObject({ text: "the", linewise: false });
    expect(last.registers['"']!.text).toBe("the");
  });

  it("recording a macro writes it, Insert-mode special keys included", async () => {
    // qm: A, type "!?" natively, Backspace (recorded by the engine as a special key), Esc, q
    keys(ta, "qmA");
    ta.value += "!?";
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "!?" }));
    keydown(ta, "Backspace");
    ta.value = ta.value.slice(0, -1);
    ta.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    keydown(ta, "Escape");
    keys(ta, "q");
    await settle();
    const m = storage.saved.at(-1)!.registers["m"]!;
    expect(m.text).toBe("A");
    expect(m.insertModeChanges[0]!.changes).toEqual([
      "!?",
      { insertModeKey: expect.objectContaining({ keyName: "Backspace" }) },
    ]);
  });

  it("a : command writes the ex history", async () => {
    keys(ta, ":");
    commandLineEnter("s/quick/slow/");
    await settle();
    expect(ta.value).toMatch(/^the slow brown/);
    expect(storage.saved.at(-1)!.exHistory).toEqual(["s/quick/slow/"]);
  });

  it("a / search writes the search history", async () => {
    keys(ta, "/");
    commandLineEnter("lazy");
    await settle();
    expect(storage.saved.at(-1)!.searchHistory).toEqual(["lazy"]);
  });

  it("a key that changes nothing (a motion) does not write again", async () => {
    keys(ta, "yiw");
    await settle();
    const writes = storage.saved.length;
    keys(ta, "wl");
    await settle();
    expect(storage.saved.length).toBe(writes);
  });

  it("a rejected write is swallowed: the in-memory register still pastes", async () => {
    storage.rejectSaves();
    keys(ta, "yiwP");
    await settle();
    expect(ta.value).toMatch(/^thethe quick/);
  });
});

/** A state another tab wrote, holding one register. */
function stateWith(registers: SessionState["registers"]): SessionState {
  return {
    registers,
    searchHistory: [],
    exHistory: [],
    lastCharacterSearch: { increment: 0, forward: true, selectedCharacter: "" },
  };
}

const plain = { linewise: false, blockwise: false, insertModeChanges: [], searchQueries: [] };

describe("Session State written elsewhere is restored before the next key", () => {
  it("a storage change carrying a register makes it pastable", async () => {
    await activated();
    storage.change(stateWith({ a: { ...plain, text: "other tab" } }));
    keys(ta, '"aP');
    expect(ta.value).toMatch(/^other tabthe quick/);
  });

  it("the state loaded at start is pastable, linewise kept", async () => {
    await activated(stateWith({ b: { ...plain, text: "a line\n", linewise: true } }));
    keys(ta, '"bp');
    expect(ta.value).toMatch(/^the quick brown fox\na line\njumps/);
  });

  it("a macro from another tab replays through its Insert-mode special key", async () => {
    await activated();
    // A, Backspace, type "xy", Esc. The engine replays a special key only when
    // it is its own class, which the serialized form cannot carry: a plain
    // object there throws inside the replay and the "xy" after it never lands.
    storage.change(
      stateWith({
        m: {
          ...plain,
          text: "A",
          insertModeChanges: [
            {
              changes: [
                {
                  insertModeKey: {
                    keyName: "Backspace",
                    key: "Backspace",
                    ctrlKey: false,
                    altKey: false,
                    metaKey: false,
                    shiftKey: false,
                  },
                },
                "xy",
              ],
              expectCursorActivityForChange: false,
            },
          ],
        },
      }),
    );
    keys(ta, "@m");
    expect(ta.value).toMatch(/^the quick brown foxxy\n/);
  });

  it("the search history from another tab is what Up recalls", async () => {
    await activated();
    storage.change({ ...stateWith({}), searchHistory: ["lazy"] });
    keys(ta, "/");
    const input = document.querySelector("vimtext-status")!.shadowRoot!.querySelector("input")!;
    // The engine walks the history on keyup.
    for (const type of ["keydown", "keyup"])
      input.dispatchEvent(
        new KeyboardEvent(type, { key: "ArrowUp", keyCode: 38, bubbles: true, composed: true }),
      );
    expect(input.value).toBe("lazy");
  });

  it("this tab's own write coming back late does not undo a newer yank", async () => {
    await activated();
    keys(ta, '"ayiw');
    await settle();
    const first = storage.saved.at(-1)!;
    keys(ta, 'w"ayiw');
    await settle();
    storage.change(first); // the echo of the first write arrives after the second yank
    keys(ta, '0"aP');
    expect(ta.value).toMatch(/^quickthe quick/);
  });
});

describe("Session State loaded at start, when keys came first", () => {
  it("a yank before the read completes is kept, the loaded registers land, and the first write carries both", async () => {
    await activated(null, { controlledLoad: true });
    keys(ta, '"byiw');
    await settle();
    expect(storage.saved).toEqual([]); // nothing is written over state not yet read
    storage.loaded(stateWith({ a: { ...plain, text: "other tab" } }));
    await settle();
    keys(ta, '"aP');
    expect(ta.value).toMatch(/^other tabthe quick/);
    keys(ta, '"bP');
    expect(ta.value).toMatch(/^other tabthethe quick/);
    const first = storage.saved[0]!;
    expect(first.registers["a"]!.text).toBe("other tab");
    expect(first.registers["b"]!.text).toBe("the");
  });

  it("a storage change that arrives before the read completes is newer: the read is ignored", async () => {
    await activated(null, { controlledLoad: true });
    storage.change(stateWith({ a: { ...plain, text: "newer" } }));
    storage.loaded(stateWith({ a: { ...plain, text: "older" } }));
    await settle();
    keys(ta, '"aP');
    expect(ta.value).toMatch(/^newerthe quick/);
  });

  it("a failed read is logged and ignored: the tab keeps its registers and writes from then on", async () => {
    await activated(null, { controlledLoad: true });
    keys(ta, "yiw");
    storage.loadFailed();
    await settle();
    keys(ta, "P");
    expect(ta.value).toMatch(/^thethe quick/);
    expect(storage.saved.at(-1)!.registers['"']!.text).toBe("the");
  });
});
