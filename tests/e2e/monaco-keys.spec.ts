import type { Page } from "@playwright/test";
import { test, expect, statusText } from "./extension";
import {
  MONACO_TEXT,
  focusMonaco,
  monacoInputKind,
  monacoSelections,
  monacoText,
  openMonaco,
  setMonacoSetting,
} from "./monaco";

// Monaco's two input kinds and what a stopped key leaves of itself on each
// (docs/engine-seams.md, "Monaco: the EditContext input" and "Monaco: a
// stopped keydown"; CODING_STANDARDS rule 12). Every case runs on the input
// kind its project asks for (tests/e2e/monaco-option.ts): `textarea.inputarea`
// in `e2e`, the EditContext input in `e2e monaco edit-context`.

/** What Monaco's input was handed for one key: the event types, in order. */
type Heard = string[];

interface RecorderWindow {
  heard: Heard;
}

/**
 * Listens, in the page's own world, where Monaco does: on the focused input
 * for `keydown`, `beforeinput` and `input`, and on its EditContext, where it
 * has one, for `textupdate`. The editor must hold focus.
 */
async function recordInput(page: Page): Promise<void> {
  await page.evaluate(() => {
    const heard: Heard = [];
    const input = document.activeElement as HTMLElement & { editContext?: EventTarget | null };
    for (const type of ["keydown", "beforeinput", "input"]) {
      input.addEventListener(type, () => heard.push(type));
    }
    input.editContext?.addEventListener("textupdate", () => heard.push("textupdate"));
    Object.assign(window, { heard });
  });
}

/** Presses `key` and returns what Monaco's input was handed for it. */
async function heardFor(page: Page, key: string): Promise<Heard> {
  await page.evaluate(() => ((window as unknown as RecorderWindow).heard.length = 0));
  await page.keyboard.press(key);
  // An `input` or a `textupdate` follows its `keydown` in the same task; the round trip of the read is later.
  return page.evaluate(() => [...(window as unknown as RecorderWindow).heard]);
}

/**
 * Adds, in an isolated world of the page as a content script's is, a
 * capture-phase `keydown` listener on `document` that stops every key the way
 * VimText's does (`preventDefault` and `stopImmediatePropagation`).
 */
async function stopKeysFromAnIsolatedWorld(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const { frameTree } = await cdp.send("Page.getFrameTree");
  const { executionContextId } = await cdp.send("Page.createIsolatedWorld", {
    frameId: frameTree.frame.id,
    worldName: "a content script's world",
  });
  const result = await cdp.send("Runtime.evaluate", {
    contextId: executionContextId,
    expression: `document.addEventListener("keydown", (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true); typeof window.fixtureMonaco`,
  });
  // The world is not the page's: the fixture's global is not there.
  expect(result.result.value).toBe("undefined");
}

/** The six keys of #117: a letter, a bracket, and four keys Monaco has commands for. */
const KEYS = ["a", "(", "Enter", "Backspace", "Tab", "Escape"];

test.describe("Monaco: the EditContext input", () => {
  test("the element Monaco focuses is the one of the project's input kind", async ({ page }) => {
    await openMonaco(page);
    await focusMonaco(page);
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement & { editContext?: unknown };
      const editor = el.closest(".monaco-editor")!;
      return {
        tag: el.localName,
        classes: [...el.classList].filter((c) => /inputarea|native-edit-context|ime-text-area/.test(c)),
        contenteditable: el.getAttribute("contenteditable"),
        isContentEditable: el.isContentEditable,
        hasEditContext: !!el.editContext,
        inputarea: editor.querySelectorAll("textarea.inputarea").length,
        nativeEditContext: editor.querySelectorAll("div.native-edit-context").length,
        imeTextArea: editor.querySelectorAll("textarea.ime-text-area").length,
      };
    });
    if (monacoInputKind() === "editContext") {
      expect(focused).toEqual({
        tag: "div",
        classes: ["native-edit-context"],
        contenteditable: null,
        isContentEditable: false,
        hasEditContext: true,
        inputarea: 0,
        nativeEditContext: 1,
        imeTextArea: 1,
      });
    } else {
      expect(focused).toEqual({
        tag: "textarea",
        classes: ["inputarea"],
        contenteditable: null,
        isContentEditable: false,
        hasEditContext: false,
        inputarea: 1,
        nativeEditContext: 0,
        imeTextArea: 0,
      });
    }
  });
});

// Observed with VimText standing down (the setting is off): the listener that
// stops the keys is the test's own, in an isolated world of its own.
test.describe("Monaco: a stopped keydown", () => {
  test("control, nothing stopped: Monaco's input is handed each key, and typing reaches it as input", async ({
    page,
  }) => {
    await openMonaco(page);
    await focusMonaco(page);
    await recordInput(page);
    const typing =
      monacoInputKind() === "editContext"
        ? ["keydown", "beforeinput", "textupdate"]
        : ["keydown", "beforeinput", "input"];
    expect(await heardFor(page, "a")).toEqual(typing);
    expect(await heardFor(page, "(")).toEqual(typing);
    for (const key of ["Enter", "Backspace", "Tab", "Escape"]) {
      expect((await heardFor(page, key))[0], key).toBe("keydown");
    }
    // "a(" (no closing bracket before a word character), Enter's line break and indent,
    // which Backspace takes back, and Tab's indent.
    expect(await monacoText(page)).toBe("a(\n  " + MONACO_TEXT);
  });

  test("a keydown stopped in the capture phase from an isolated world leaves Monaco no keydown, beforeinput, input or textupdate, and its text and selection as they were", async ({
    page,
  }) => {
    await openMonaco(page);
    await focusMonaco(page, 3);
    await recordInput(page);
    await stopKeysFromAnIsolatedWorld(page);
    for (const key of KEYS) expect(await heardFor(page, key), key).toEqual([]);
    expect(await monacoText(page)).toBe(MONACO_TEXT);
    expect(await monacoSelections(page)).toEqual([{ anchor: 3, head: 3 }]);
  });
});

test.describe("outside Insert, the keys VimText takes leave Monaco's input nothing", () => {
  test("the Activating Esc, a letter, a bracket, Enter and Backspace in Normal: no keydown, beforeinput, input or textupdate", async ({
    page,
    context,
  }) => {
    await setMonacoSetting(context, true);
    await openMonaco(page);
    // Offset 23: inside "  return a + b;", the second line, so every motion below has room.
    await focusMonaco(page, 23);
    await recordInput(page);
    expect(await heardFor(page, "Escape")).toEqual([]);
    await expect.poll(() => statusText(page)).toContain("NORMAL");
    // `l`, `(`, Enter and Backspace are motions in Normal: Monaco would type or delete with each.
    for (const key of ["l", "(", "Enter", "Backspace"]) expect(await heardFor(page, key), key).toEqual([]);
    expect(await monacoText(page)).toBe(MONACO_TEXT);
  });
});
