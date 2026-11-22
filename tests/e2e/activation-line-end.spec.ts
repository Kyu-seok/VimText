import type { Page } from "@playwright/test";
import {
  test,
  expect,
  ready,
  brightness,
  caretCharBox,
  cursorChar,
  drawnCursor,
  fixtureOrigin,
  near,
  setSettings,
  statusText,
} from "./extension";

/**
 * Activation with the caret at the end of a line that has text puts the
 * Cursor on that line's last character, as Vim's Esc out of Insert does (#99):
 * the Field's caret is the mirror's first cursor, and a Normal-mode Cursor
 * never sits past its line's last character.
 */

interface Case {
  name: string;
  url: string;
  /** The element that takes focus: the Field, or the editable root that holds it. */
  focus: string;
  /** The Field: a textarea or input, or the block whose one text node holds the caret. */
  field: string;
  /** The open shadow root's host whose own selection holds the caret. */
  shadowHost?: string;
  /** The caret's offset before the Activating Esc, at a line's end. */
  caret: number;
  /** The line's last character and the one before it. */
  last: string;
  beforeLast: string;
  /** The Field's text once `x` has deleted the line's last character. */
  afterX: string;
}

const CASES: Case[] = [
  {
    name: "a textarea, the caret at the text's end",
    url: "/textarea.html",
    focus: "#ta",
    field: "#ta",
    caret: 59,
    last: "e",
    beforeLast: "r",
    afterX: "the quick brown fox\njumps over the lazy dog\nthird line her",
  },
  {
    name: "a textarea, the caret at an inner line's end",
    url: "/textarea.html",
    focus: "#ta",
    field: "#ta",
    caret: 19,
    last: "x",
    beforeLast: "o",
    afterX: "the quick brown fo\njumps over the lazy dog\nthird line here",
  },
  {
    name: "a Single-line Field",
    url: "/single-line.html",
    focus: "#in",
    field: "#in",
    caret: 11,
    last: "d",
    beforeLast: "l",
    afterX: "hello worl",
  },
  {
    name: "a plain contenteditable, the caret at the last line's end",
    url: "/contenteditable.html",
    focus: "#ce",
    field: "#ce > p:last-child",
    caret: 9,
    last: "e",
    beforeLast: "n",
    afterX: "last lin",
  },
  {
    name: "a contenteditable in an open shadow root, the caret at the last line's end",
    url: "/shadow-contenteditable.html",
    focus: "#ce",
    field: "#ce > p:last-child",
    shadowHost: "#editor",
    caret: 9,
    last: "e",
    beforeLast: "n",
    afterX: "last lin",
  },
  {
    name: "a block of the Notion shape, one line",
    url: "/site-shapes.html",
    focus: "#notion",
    field: "#n-one",
    caret: 16,
    last: "a",
    beforeLast: "m",
    afterX: "alpha beta gamm",
  },
  {
    name: "a three-line block of the Notion shape, the caret at the text's end",
    url: "/site-shapes.html",
    focus: "#notion",
    field: "#n-two",
    caret: 28,
    last: "e",
    beforeLast: "e",
    afterX: "line one\nline two\nline thre",
  },
  {
    name: "a three-line block of the Notion shape, the caret at the first line's end",
    url: "/site-shapes.html",
    focus: "#notion",
    field: "#n-two",
    caret: 8,
    last: "e",
    beforeLast: "n",
    afterX: "line on\nline two\nline three",
  },
];

/** Whether the Field is a textarea or input: its Normal Cursor is a one-character selection. */
function isControl(page: Page, c: Case): Promise<boolean> {
  return page
    .locator(c.field)
    .evaluate((el) => el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement);
}

/** Focuses the Field, puts the caret at `caret` in it and presses the Activating Esc. */
async function activateAt(page: Page, c: Case): Promise<void> {
  await page.goto(c.url);
  await ready(page);
  await page.locator(c.focus).focus();
  await page.locator(c.field).evaluate((el, at) => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.setSelectionRange(at, at);
    else el.ownerDocument.getSelection()!.collapse(el.firstChild, at);
  }, c.caret);
  await page.keyboard.press("Escape");
  await expect.poll(() => statusText(page)).toContain("NORMAL");
}

/**
 * The Cursor as the Field's selection renders it: its character and that
 * character's offset. On a textarea or input the one selected character (""
 * when nothing is selected); on a contenteditable the character after the
 * caret (null when the selection is not a caret) and the caret's offset in its
 * text node.
 */
function cursor(page: Page, c: Case): Promise<{ char: string | null; at: number }> {
  return page.locator(c.field).evaluate((el) => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
      return { char: el.value.slice(el.selectionStart!, el.selectionEnd!), at: el.selectionStart! };
    // Inside an open shadow root the document's selection is retargeted to the host; the root's own is read.
    const sel = (el.getRootNode() as Document).getSelection()!;
    const node = sel.anchorNode;
    const char = sel.isCollapsed && node instanceof Text ? (node.data[sel.anchorOffset] ?? "") : null;
    return { char, at: sel.anchorOffset };
  });
}

/** The Field's text: a control's value, a contenteditable block's rendered text. */
function text(page: Page, c: Case): Promise<string> {
  return page
    .locator(c.field)
    .evaluate((el: HTMLElement) =>
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : el.innerText,
    );
}

for (const c of CASES) {
  test(`${c.name}: the Activating Esc puts the Cursor on the line's last character; l leaves it, h moves one left`, async ({
    page,
  }) => {
    await activateAt(page, c);
    const onLast = { char: c.last, at: c.caret - 1 };
    await expect.poll(() => cursor(page, c)).toEqual(onLast);
    if (!(await isControl(page, c))) {
      // The block is drawn over that character, not past the text.
      await expect
        .poll(async () => {
          const [drawn, box] = await Promise.all([drawnCursor(page), caretCharBox(page, c.shadowHost)]);
          return drawn?.shape === "block" && near(drawn, box);
        })
        .toBe(true);
      // Painted there, not only placed (CODING_STANDARDS rule 14): the character is inverted.
      expect(await brightness(page, (await drawnCursor(page))!)).toBeLessThan(128);
    }
    await page.keyboard.type("l");
    await expect.poll(() => cursor(page, c)).toEqual(onLast);
    await page.keyboard.type("h");
    await expect.poll(() => cursor(page, c)).toEqual({ char: c.beforeLast, at: c.caret - 2 });
  });

  test(`${c.name}: x pressed first deletes the line's last character and nothing else`, async ({ page }) => {
    await activateAt(page, c);
    // Everything the focused element holds, the Field's siblings with it: a block beside it loses nothing.
    const whole = () => page.locator(c.focus).evaluate((el) => el.textContent!);
    const [before, fieldBefore] = [await whole(), await text(page, c)];
    await page.keyboard.type("x");
    await expect.poll(() => text(page, c)).toBe(c.afterX);
    if (!(await isControl(page, c))) expect(await whole()).toBe(before.replace(fieldBefore, c.afterX));
  });
}

test("the caret on an empty line Activates with the Cursor at that line's start", async ({ page }) => {
  // The plain contenteditable's fourth block is empty, its placeholder <br> in it.
  await page.goto("/contenteditable.html");
  await ready(page);
  await page.locator("#ce").focus();
  await page
    .locator("#ce > p:nth-child(4)")
    .evaluate((el) => el.ownerDocument.getSelection()!.collapse(el, 0));
  await page.keyboard.press("Escape");
  await expect.poll(() => statusText(page)).toContain("NORMAL");
  expect(await cursorChar(page)).toBe("");
  await page.keyboard.type("ihere");
  await expect.poll(() => page.locator("#ce > p:nth-child(4)").innerText()).toBe("here");
  expect(await page.locator("#ce > p:last-child").innerText()).toBe("last line");
});

test("a Field focused on a Site whose policy is 'normal', the caret at its end, Activates with the Cursor on the last character", async ({
  context,
  page,
}) => {
  await setSettings(context, { enabled: true, sites: { [fixtureOrigin]: "normal" }, vimrc: "", plugins: {} });
  await page.goto("/textarea.html");
  // The settings have arrived: the focus itself Activates, not their arrival on a Field already focused.
  await ready(page);
  const ta = page.locator("#ta");
  // A blurred textarea takes a selection without taking focus.
  await ta.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
  await ta.focus();
  await expect.poll(() => statusText(page)).toContain("NORMAL");
  expect(await ta.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([
    58, 59,
  ]);
  await page.keyboard.type("x");
  await expect(ta).toHaveValue("the quick brown fox\njumps over the lazy dog\nthird line her");
});
