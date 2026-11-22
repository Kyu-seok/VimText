import { test as base, chromium, type BrowserContext, type Frame, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { freemem, loadavg } from "node:os";

const dist = resolve("dist");

import { fixtureOrigin } from "./fixture-port";
import { decodePng } from "../png";

export { fixtureOrigin };

/**
 * Launches Chromium with the built extension loaded (needs `npm run build`
 * first). A project sets the window through Playwright's own `viewport` and
 * `deviceScaleFactor` options (the screenshot project does); their defaults
 * are what a persistent context opens with anyway.
 */
export const test = base.extend<{ context: BrowserContext; page: Page }>({
  context: async ({ viewport, deviceScaleFactor }, use, testInfo) => {
    const launching = Date.now();
    const userDataDir = mkdtempSync(resolve(tmpdir(), "vimtext-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: true,
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
      viewport,
      deviceScaleFactor,
    });
    // Printed with a failure: the launch counts against the test's timeout, and on a stalled
    // machine it alone took 20 to 30 s in every worker at once (#79, #83). A failure that
    // shows a slow launch or a load average far above the core count may be the machine's.
    // Free memory beside it: the stalls of #83 came with about 40 MB free and most of the swap in use.
    await testInfo.attach("machine", {
      body: `browser launch ${Date.now() - launching} ms, load average ${loadavg()[0]!.toFixed(1)}, free memory ${Math.round(freemem() / 2 ** 20)} MB`,
    });
    await use(context);
    await context.close();
    // Each profile is about 5 MB; left behind, a gate run leaves ~125 of them
    // and a session of gates filled 37 GB of the temp folder.
    rmSync(userDataDir, { recursive: true, force: true });
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error" && /VimText/.test(m.text())) errors.push(`console: ${m.text()}`);
    });
    await use(page);
    // An engine exception shows up as a wrong value otherwise; fail loudly instead.
    base.expect(errors, "VimText errors during the test").toEqual([]);
  },
});

export const expect = base.expect;

/** Chrome derives an unpacked extension's id from the SHA-256 of its absolute path. */
export const extensionId = createHash("sha256")
  .update(dist)
  .digest("hex")
  .slice(0, 32)
  .replace(/[0-9a-f]/g, (c) => String.fromCharCode("a".charCodeAt(0) + parseInt(c, 16)));

/** Writes settings via the options page (the only context with chrome.storage). */
export async function setSettings(context: BrowserContext, settings: object): Promise<void> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options/options.html`);
  await page.evaluate((s) => chrome.storage.sync.set({ settings: s }), settings);
  await page.close();
}

/**
 * Resolves once the content script has run in `where` (a page or a frame) and
 * its settings have arrived: it marks its document for each, so no spec
 * guesses how long `document_idle` and the storage read take. Before the
 * settings arrive an Esc is only remembered and the keys typed after it are
 * the page's, which a spec that types right after Esc read as a flake (#79:
 * `cwslow` typed into the textarea). The window itself is tested on purpose in
 * `tests/unit/sessions.test.ts` and `lexical.spec.ts` (#79).
 */
export async function ready(where: Page | Frame): Promise<void> {
  await where.waitForSelector('html[data-vimtext="ready"]', { state: "attached" });
}

/** The Status Line host VimText injects next to an activated Field, in that page or frame. */
export function statusText(page: Page | Frame): Promise<string> {
  return page.evaluate(() => {
    const host = document.querySelector("vimtext-status") as HTMLElement | null;
    const bar = host?.shadowRoot?.querySelector(".bar") as HTMLElement | null;
    return bar && !host!.hidden ? (bar.textContent ?? "") : "";
  });
}

/** Toggles a Plugin in the options page; it applies at the next Activation, the rule the vimrc follows. */
export async function setPlugin(page: Page, plugin: "surround" | "targets", on: boolean): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/options/options.html`);
  const toggle = page.locator(`#plugin-${plugin}`);
  await toggle.setChecked(on);
  await base.expect(toggle).toBeChecked({ checked: on });
}

/** Opens the textarea fixture with VimText Activated on `#ta`, the caret at its start. */
export async function openActivated(page: Page): Promise<void> {
  await page.goto("/textarea.html");
  await ready(page);
  await activateAtStart(page, "#ta");
}

/**
 * Focuses a Field, parks the caret at its start and Activates VimText with Esc.
 * A textarea or input takes `setSelectionRange`; a contenteditable host a
 * collapsed native selection at its start.
 */
export async function activateAtStart(page: Page, selector = "#in"): Promise<void> {
  const field = page.locator(selector);
  await field.focus();
  await field.evaluate((el: HTMLElement) => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.setSelectionRange(0, 0);
    else el.ownerDocument.getSelection()!.collapse(el, 0);
  });
  await page.keyboard.press("Escape");
  await base.expect.poll(() => statusText(page)).toContain("NORMAL");
}

/**
 * Opens the command line with `line`'s first character, types the rest,
 * presses Enter and waits for the Status Line to show `notice`.
 */
export async function submitForNotice(page: Page, line: string, notice: string): Promise<void> {
  await page.keyboard.press(line[0]!);
  await base.expect.poll(() => statusText(page)).toContain(line[0]!);
  await page.keyboard.type(line.slice(1));
  await page.keyboard.press("Enter");
  await base.expect.poll(() => statusText(page)).toContain(notice);
}

/** Two command lines whose Enter ends in a notice: one the engine's, one VimText's own (#90). */
export const noticeLines = [
  { line: "/zzz", notice: "No match found" },
  { line: ":w", notice: "nothing to write" },
];

/** The text of each direct child block of a contenteditable host, a no-break space read as the space it renders as. */
export function blockTexts(page: Page | Frame, selector: string): Promise<string[]> {
  return page
    .locator(selector)
    .evaluate((el) => [...el.children].map((c) => (c.textContent ?? "").replace(/\u00a0/g, " ")));
}

/**
 * The page editor's own text, one line per block, read through the fixture's
 * `window.modelText()` from the editor's model, not the DOM: the read that
 * shows a Diverged Edit, which the DOM hides. Each rich-editor fixture
 * (tests/fixtures/quill.ts and the others) exposes it.
 */
export function modelText(page: Page | Frame): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { modelText(): string[] }).modelText());
}

/**
 * The page editor's own selection, read through the fixture's
 * `window.modelSelection()` from the editor's model, in that editor's own
 * terms (ProseMirror `{ anchor, head }` positions, Slate's `editor.selection`,
 * Quill's `{ index, length }`, Lexical's anchor and focus `{ key, offset, type }`).
 * The read that shows an editor holding a selection other than the DOM's,
 * which only a debugging session would otherwise find (#76's `:q` regression).
 */
export function modelSelection(page: Page | Frame): Promise<unknown> {
  return page.evaluate(() => (window as unknown as { modelSelection(): unknown }).modelSelection());
}

/**
 * The text the native selection covers in that page or frame: a Normal-mode
 * cursor's character. With `shadowHost`, the selection inside that element's
 * open shadow root, read through Chromium's `ShadowRoot.getSelection`: the
 * document's selection is retargeted to the host there.
 */
export function selectedText(page: Page | Frame, shadowHost?: string): Promise<string> {
  return page.evaluate((hostSelector) => {
    if (!hostSelector) return document.getSelection()?.toString() ?? "";
    const root = document.querySelector(hostSelector)!.shadowRoot as ShadowRoot & {
      getSelection(): Selection;
    };
    return root.getSelection().toString();
  }, shadowHost);
}

/**
 * The character just after a collapsed native selection, read from the DOM in
 * that page or frame: the Normal-mode Cursor's character on a contenteditable
 * Field, whose selection there is a caret before it (ADR 0009). "" when the
 * caret ends its line (an empty block, before a `<br>` or a block boundary),
 * null when the selection is not collapsed. With `shadowHost`, the selection
 * inside that element's open shadow root, as for `selectedText`.
 */
export function cursorChar(page: Page | Frame, shadowHost?: string): Promise<string | null> {
  return page.evaluate((hostSelector) => {
    const sel = hostSelector
      ? (
          document.querySelector(hostSelector)!.shadowRoot as ShadowRoot & { getSelection(): Selection }
        ).getSelection()
      : document.getSelection()!;
    if (!sel.isCollapsed || !sel.anchorNode) return null;
    let node: Node | null = sel.anchorNode;
    const offset = sel.anchorOffset;
    if (node instanceof Text && offset < node.data.length) return node.data[offset]!;
    const endsLine = (n: Node) =>
      n instanceof HTMLBRElement ||
      (n instanceof HTMLElement && !getComputedStyle(n).display.startsWith("inline"));
    /** The node after `n`'s subtree in document order, or null past a line's end. */
    const after = (n: Node | null): Node | null => {
      while (n && !n.nextSibling) {
        n = n.parentNode;
        if (!n || endsLine(n)) return null;
      }
      return n?.nextSibling ?? null;
    };
    node =
      !(node instanceof Text) && offset < node.childNodes.length ? node.childNodes[offset]! : after(node);
    while (node) {
      if (endsLine(node)) return "";
      if (node instanceof Text && node.data.length) return node.data[0]!;
      node = node.firstChild ?? after(node);
    }
    return "";
  }, shadowHost);
}

/** A rect as a test compares it: rounded to the pixel. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The Cursor VimText draws on a contenteditable Field (ADR 0009), as the user
 * sees it: its box in the frame's viewport and its shape, null when none is
 * drawn. Like `statusText`, a sanctioned read of the Status Line host
 * (CODING_STANDARDS rule 6): it returns only what the user sees.
 */
export function drawnCursor(page: Page | Frame): Promise<(Box & { shape: string }) | null> {
  return page.evaluate(() => {
    for (const host of document.querySelectorAll("vimtext-status")) {
      const el = host.shadowRoot?.querySelector(".cursor") as HTMLElement | null;
      if (!el || el.style.display === "none") continue;
      const r = el.getBoundingClientRect();
      return {
        shape: el.dataset.shape ?? "",
        left: Math.round(r.left),
        top: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    }
    return null;
  });
}

/** The mean brightness (0–255) of what Chromium painted in `box` of the viewport, read from a screenshot (CODING_STANDARDS rule 14). */
export async function brightness(page: Page, box: Box): Promise<number> {
  const png = decodePng(
    await page.screenshot({ clip: { x: box.left, y: box.top, width: box.width, height: box.height } }),
  );
  let sum = 0;
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++) {
      const [r, g, b] = png.at(x, y);
      sum += (r + g + b) / 3;
    }
  return sum / (png.width * png.height);
}

/** How many Status Line hosts VimText has on the page; one per live Session. */
export function hostCount(page: Page | Frame): Promise<number> {
  return page.evaluate(() => document.querySelectorAll("vimtext-status").length);
}

/** What the content script of a tab's top frame reports (the popup's `vimtext:status` query). */
export interface ContentStatus {
  /** The Site origin: the top page's. */
  origin: string;
  /** True while the top frame's lifecycle MutationObserver is connected (only while a Session exists). */
  observing: boolean;
}

/**
 * Asks the content script of the fixture tab's top frame for its status,
 * through an extension page (the only context with `chrome.tabs`). Pinned to
 * frame 0: without it every frame answers and the first one wins. Tabs without
 * the content script (extension pages themselves) do not answer and are skipped.
 */
export async function contentStatus(context: BrowserContext): Promise<ContentStatus> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options/options.html`);
  const statuses = await page.evaluate(async (origin) => {
    const tabs = await chrome.tabs.query({});
    const answers: ContentStatus[] = [];
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        const res = (await chrome.tabs.sendMessage(
          tab.id,
          { type: "vimtext:status" },
          { frameId: 0 },
        )) as ContentStatus;
        if (res?.origin === origin) answers.push(res);
      } catch {
        // no content script in this tab
      }
    }
    return answers;
  }, fixtureOrigin);
  await page.close();
  if (statuses.length !== 1) throw new Error(`expected one fixture tab, got ${statuses.length}`);
  return statuses[0]!;
}
