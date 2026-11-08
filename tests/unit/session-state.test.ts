import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Sessions, type SessionStatePort, type SettingsPort } from "../../src/content/Sessions";
import { DEFAULT_SETTINGS, type Settings } from "../../src/settings/settings";
import type { SessionState } from "../../src/settings/sessionState";

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
function fakeStorage(initial: SessionState | null = null) {
  const saved: SessionState[] = [];
  let handler: ((s: SessionState) => void) | null = null;
  let failSave = false;
  const port: SessionStatePort = {
    load: () => Promise.resolve(initial),
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
  };
}

function keydown(el: Element, key: string, init: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true, ...init });
  el.dispatchEvent(e);
  return e;
}

function keys(el: Element, seq: string): void {
  for (const ch of seq) keydown(el, ch);
}

/** Enough turns of the microtask queue for a resolved load and a queued snapshot to be handled. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
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

async function activated(initial: SessionState | null = null): Promise<void> {
  storage = fakeStorage(initial);
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
});
