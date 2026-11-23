import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { installProbe, type DogfoodProbe } from "../../tools/dogfood-probe.mjs";
import { keydown } from "./dom";

/**
 * The probe an agent injects on a live site in a dogfooding pass
 * (`tools/dogfood-probe.mjs`, docs/release.md): a key that arrives while focus
 * is outside the Field under test never reaches the page (#108, where such
 * keys ran Gmail's shortcuts), and `state()` reports it.
 */

interface State {
  text: string | null;
  selection: { start: number | null } | null;
  focused: boolean;
  active: string;
  leaks: string[];
  focus: string[];
}

let probe: DogfoodProbe;
let pageSaw: string[];
const state = (): State => JSON.parse(probe.state()) as State;

beforeAll(() => {
  probe = installProbe();
  // The page's own shortcut handler: registered after the probe, as a site's is after an injected script's.
  document.addEventListener("keydown", (e) => pageSaw.push(e.key));
});

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  pageSaw = [];
  return document.body.firstElementChild as HTMLElement;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the dogfooding probe", () => {
  it("lets a key through while the Field has focus, and reads its text and selection", () => {
    const field = mount(`<textarea>alpha beta</textarea><button>other</button>`) as HTMLTextAreaElement;
    probe.watch(field);
    field.setSelectionRange(6, 7);
    const e = keydown(field, "x");
    expect(e.defaultPrevented).toBe(false);
    expect(pageSaw).toEqual(["x"]);
    expect(state()).toMatchObject({ text: "alpha beta", selection: { start: 6 }, focused: true, leaks: [] });
  });

  it("stops a key that arrives after focus left the Field, and lists it once", () => {
    const field = mount(`<textarea>alpha</textarea><button>other</button>`);
    probe.watch(field);
    const other = document.querySelector("button")!;
    other.focus();
    const e = keydown(other, "u");
    expect(e.defaultPrevented).toBe(true);
    expect(pageSaw).toEqual([]);
    const first = state();
    expect(first.leaks).toEqual(["u at button"]);
    expect(first.focused).toBe(false);
    expect(first.focus.some((line) => line.includes("focusout FIELD"))).toBe(true);
    expect(state().leaks).toEqual([]);
  });

  it("stops Enter in the Field where Enter sends, and leaves Shift+Enter alone", () => {
    const field = mount(`<div contenteditable="true">hello</div>`);
    probe.watch(field, { enterSends: true });
    expect(keydown(field, "Enter").defaultPrevented).toBe(true);
    expect(keydown(field, "Enter", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(pageSaw).toEqual(["Enter"]);
    expect(state().leaks).toEqual(["Enter at FIELD"]);
  });

  it("counts a block as focused when the editable root around it holds focus, as on Notion", () => {
    const root = mount(
      `<div contenteditable="true"><div contenteditable="true" id="block">omega</div></div>`,
    );
    const block = root.querySelector<HTMLElement>("#block")!;
    probe.watch(block);
    root.focus();
    expect(keydown(root, "x").defaultPrevented).toBe(false);
    expect(state()).toMatchObject({ text: "omega", focused: true, leaks: [] });
  });

  it("lets keys through while VimText's command line holds focus", () => {
    const field = mount(`<textarea>alpha</textarea><vimtext-status tabindex="0"></vimtext-status>`);
    probe.watch(field);
    const host = document.querySelector<HTMLElement>("vimtext-status")!;
    host.focus();
    expect(keydown(host, "Enter").defaultPrevented).toBe(false);
    expect(state().leaks).toEqual([]);
  });
});
