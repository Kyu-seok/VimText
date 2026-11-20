import type { Page } from "@playwright/test";
import {
  test,
  expect,
  ready,
  activateAtStart,
  brightness,
  drawnCursor,
  statusText,
  type Box,
} from "./extension";

/**
 * On a contenteditable Field VimText draws the Normal-mode Cursor itself and
 * leaves the page's selection a caret collapsed before the Cursor's character
 * (ADR 0009, DESIGN.md "Cursor", #71): a page reads a one-character selection
 * as a person selecting a character and opens its toolbar over it.
 */

interface Fixture {
  name: string;
  url: string;
  host: string;
  /** The open shadow root's host whose own selection holds the caret. */
  shadowHost?: string;
  /** Activated the Notion way: focus on the editable root, the caret in the block. */
  nested?: boolean;
}

const FIXTURES: Fixture[] = [
  { name: "plain", url: "/contenteditable.html", host: "#ce" },
  { name: "plaintext-only", url: "/contenteditable.html?contenteditable=plaintext-only", host: "#ce" },
  { name: "shadow-rooted", url: "/shadow-contenteditable.html", host: "#ce", shadowHost: "#editor" },
  { name: "ProseMirror", url: "/prosemirror.html", host: "#editor .ProseMirror" },
  { name: "Lexical", url: "/lexical.html", host: "#editor" },
  { name: "Slate", url: "/slate.html", host: "#editor" },
  { name: "Quill", url: "/quill.html", host: "#editor .ql-editor" },
  { name: "the Notion site-shape", url: "/site-shapes.html", host: "#n-two", nested: true },
];

async function activate(page: Page, f: Fixture, pageStyle?: string): Promise<void> {
  await page.goto(f.url);
  if (pageStyle) await page.addStyleTag({ content: pageStyle });
  await ready(page);
  if (!f.nested) return activateAtStart(page, f.host);
  await page.locator("#notion").focus();
  await page.locator(f.host).evaluate((el) => el.ownerDocument.getSelection()!.collapse(el.firstChild, 0));
  await page.keyboard.press("Escape");
  await expect.poll(() => statusText(page)).toContain("NORMAL");
}

/**
 * The box of the character after the collapsed caret, read from the page's
 * DOM: its Range's last client rect with a width (a character split by a soft
 * wrap). Null when the selection is not a caret inside a text node.
 */
function caretCharBox(page: Page, shadowHost?: string): Promise<Box | null> {
  return page.evaluate((hostSelector) => {
    const sel = hostSelector
      ? (
          document.querySelector(hostSelector)!.shadowRoot as ShadowRoot & { getSelection(): Selection }
        ).getSelection()
      : document.getSelection()!;
    const node = sel.anchorNode;
    if (!sel.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE) return null;
    if (sel.anchorOffset >= (node as Text).data.length) return null;
    const range = document.createRange();
    range.setStart(node, sel.anchorOffset);
    range.setEnd(node, sel.anchorOffset + 1);
    const r = [...range.getClientRects()].filter((x) => x.width > 0).at(-1);
    if (!r) return null;
    return {
      left: Math.round(r.left),
      top: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }, shadowHost);
}

/**
 * The mean brightness (0–255) Chromium painted inside the drawn block: dark
 * where the block inverts the white page and the character's dark glyph,
 * white where it is painted opaque.
 */
async function brightnessUnderBlock(page: Page): Promise<number> {
  return brightness(page, (await drawnCursor(page))!);
}

/** Within a pixel: the block is placed from the same rect, rounded on its own. */
function near(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return false;
  return (
    Math.abs(a.left - b.left) <= 1 &&
    Math.abs(a.top - b.top) <= 1 &&
    Math.abs(a.width - b.width) <= 1 &&
    Math.abs(a.height - b.height) <= 1
  );
}

/**
 * The selection is a caret before a character (null otherwise: not collapsed,
 * or at a line's end), and the drawn block's box is that character's.
 */
async function expectBlockOnCaret(page: Page, f: Fixture): Promise<void> {
  await expect
    .poll(async () => {
      const [drawn, box] = await Promise.all([drawnCursor(page), caretCharBox(page, f.shadowHost)]);
      return drawn?.shape === "block" && near(drawn, box);
    })
    .toBe(true);
}

for (const f of FIXTURES) {
  test(`${f.name}: after l w j x and Esc out of Insert the selection is a caret and the block is drawn over the Cursor's character`, async ({
    page,
  }) => {
    await activate(page, f);
    await expectBlockOnCaret(page, f);
    // Painted, not only placed: the character and the page beneath are inverted.
    expect(await brightnessUnderBlock(page)).toBeLessThan(128);
    for (const key of ["l", "w", "j", "x"]) {
      await page.keyboard.type(key);
      await expectBlockOnCaret(page, f);
    }
    await page.keyboard.type("i");
    await expect.poll(() => statusText(page)).toContain("INSERT");
    await page.keyboard.press("Escape");
    await expect.poll(() => statusText(page)).toContain("NORMAL");
    await expectBlockOnCaret(page, f);
  });
}

test.describe("on a plain contenteditable", () => {
  const plain = FIXTURES[0]!;
  test.beforeEach(async ({ page }) => activate(page, plain));

  test("Replace draws a bar along the character's bottom", async ({ page }) => {
    await page.keyboard.type("lR");
    await expect.poll(() => statusText(page)).toContain("REPLACE");
    await expect
      .poll(async () => {
        const [drawn, box] = await Promise.all([drawnCursor(page), caretCharBox(page)]);
        if (!drawn || !box) return null;
        return {
          shape: drawn.shape,
          left: Math.abs(drawn.left - box.left) <= 1,
          width: Math.abs(drawn.width - box.width) <= 1,
          bottom: Math.abs(drawn.top + drawn.height - (box.top + box.height)) <= 1,
          height: drawn.height,
        };
      })
      .toEqual({ shape: "bar", left: true, width: true, bottom: true, height: 2 });
  });

  test("Insert, Visual and Command-line draw nothing, and blurring the Field hides the block", async ({
    page,
  }) => {
    await expectBlockOnCaret(page, plain);
    await page.keyboard.type("i");
    await expect.poll(() => statusText(page)).toContain("INSERT");
    await expect.poll(() => drawnCursor(page)).toBeNull();
    await page.keyboard.press("Escape");
    await expectBlockOnCaret(page, plain);
    await page.keyboard.type("v");
    await expect.poll(() => statusText(page)).toContain("VISUAL");
    await expect.poll(() => drawnCursor(page)).toBeNull();
    await page.keyboard.press("Escape");
    await expectBlockOnCaret(page, plain);
    await page.keyboard.press(":");
    await expect.poll(() => drawnCursor(page)).toBeNull();
    // Esc closes the command line and focuses the Field again.
    await page.keyboard.press("Escape");
    await expectBlockOnCaret(page, plain);
    await page.locator("#ce").evaluate((el) => (el as HTMLElement).blur());
    await expect.poll(() => drawnCursor(page)).toBeNull();
  });

  test("the page's caret is transparent while the block shows and restored in Insert; no attribute in the Field changes", async ({
    page,
  }) => {
    const caretColor = () => page.locator("#ce").evaluate((el) => getComputedStyle(el).caretColor);
    const shown = await caretColor();
    await page.locator("#ce").evaluate((el) => {
      const w = window as unknown as { attrs: string[] };
      w.attrs = [];
      new MutationObserver((records) => {
        for (const r of records) w.attrs.push(`${(r.target as Element).localName}[${r.attributeName}]`);
      }).observe(el, { attributes: true, subtree: true });
    });
    await expectBlockOnCaret(page, plain);
    expect(shown).toBe("rgba(0, 0, 0, 0)");
    await page.keyboard.type("i");
    await expect.poll(() => statusText(page)).toContain("INSERT");
    await expect.poll(caretColor).not.toBe("rgba(0, 0, 0, 0)");
    await page.keyboard.press("Escape");
    await expectBlockOnCaret(page, plain);
    await expect.poll(caretColor).toBe("rgba(0, 0, 0, 0)");
    await page.keyboard.type("wxj");
    await expectBlockOnCaret(page, plain);
    expect(await page.evaluate(() => (window as unknown as { attrs: string[] }).attrs)).toEqual([]);
  });
});

test.describe("shapes and scrolling", () => {
  const f: Fixture = { name: "drawn-cursor", url: "/drawn-cursor.html", host: "#ce" };
  test.beforeEach(async ({ page }) => activate(page, f));

  /** The width of `0` in the Field's font, as the page measures it. */
  function zeroWidth(page: Page): Promise<number> {
    return page.locator("#ce").evaluate((el) => {
      const ctx = document.createElement("canvas").getContext("2d")!;
      ctx.font = getComputedStyle(el).font;
      return Math.round(ctx.measureText("0").width);
    });
  }

  function boxOf(page: Page, selector: string): Promise<Box> {
    return page.locator(selector).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: Math.round(r.left),
        top: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    });
  }

  test("an Atom gets a block over its whole box", async ({ page }) => {
    await page.keyboard.type("lll");
    const chip = await boxOf(page, "#ce .mention");
    await expect.poll(async () => near(await drawnCursor(page), chip)).toBe(true);
  });

  test("an empty line gets a block one 0 wide at the line's start", async ({ page }) => {
    await page.keyboard.type("j");
    const line = await boxOf(page, "#ce p:nth-child(2)");
    const zero = await zeroWidth(page);
    await expect
      .poll(async () => {
        const drawn = await drawnCursor(page);
        if (!drawn) return null;
        return {
          left: Math.abs(drawn.left - line.left) <= 1,
          width: Math.abs(drawn.width - zero) <= 1,
          inLine: drawn.top >= line.top - 1 && drawn.top + drawn.height <= line.top + line.height + 1,
        };
      })
      .toEqual({ left: true, width: true, inLine: true });
  });

  test("a space at a soft wrap gets a block one 0 wide at the end of the line it ends; the next character its own box", async ({
    page,
  }) => {
    await page.keyboard.type("jj20l");
    const lastA = await page.locator("#ce p:nth-child(3)").evaluate((p) => {
      const range = document.createRange();
      range.setStart(p.firstChild!, 19);
      range.setEnd(p.firstChild!, 20);
      const r = range.getBoundingClientRect();
      return { right: Math.round(r.right), top: Math.round(r.top), height: Math.round(r.height) };
    });
    const zero = await zeroWidth(page);
    await expect
      .poll(async () => {
        const d = await drawnCursor(page);
        return (
          !!d &&
          Math.abs(d.left - lastA.right) <= 1 &&
          Math.abs(d.top - lastA.top) <= 1 &&
          Math.abs(d.width - zero) <= 1
        );
      })
      .toBe(true);
    await page.keyboard.type("l");
    await expectBlockOnCaret(page, f);
    expect((await drawnCursor(page))!.top).toBeGreaterThan(lastA.top + lastA.height - 2);
  });

  test("the block follows a scroll of an inner scroller and is hidden once the character is out of view", async ({
    page,
  }) => {
    await expectBlockOnCaret(page, f);
    const before = (await drawnCursor(page))!;
    await page.locator("#scroller").evaluate((el) => (el.scrollTop = 6));
    await expect.poll(async () => (await drawnCursor(page))?.top).toBe(before.top - 6);
    await expectBlockOnCaret(page, f);
    await page.locator("#scroller").evaluate((el) => (el.scrollTop = 60));
    await expect.poll(() => drawnCursor(page)).toBeNull();
    await page.locator("#scroller").evaluate((el) => (el.scrollTop = 0));
    await expectBlockOnCaret(page, f);
  });
});

test.describe("the block inverts what is beneath it", () => {
  const f: Fixture = { name: "drawn-cursor", url: "/drawn-cursor.html", host: "#ce" };

  test("on a plain page", async ({ page }) => {
    await activate(page, f);
    await expectBlockOnCaret(page, f);
    expect(await brightnessUnderBlock(page)).toBeLessThan(128);
  });

  // Notion gives every element `isolation: isolate`, VimText's own host too: a
  // page's rule for the host beats the shadow root's `:host`, and a host that
  // is a stacking context left the block nothing to blend with, an opaque
  // white box hiding the character (found live on Notion, #76).
  test("on a page whose rules make every element its own stacking context", async ({ page }) => {
    await activate(page, f, "* { isolation: isolate; }");
    await expectBlockOnCaret(page, f);
    expect(await brightnessUnderBlock(page)).toBeLessThan(128);
  });
});
