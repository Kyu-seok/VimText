import { test, expect, ready, activateAtStart, modelText, statusText } from "./extension";
import type { Page } from "@playwright/test";

/**
 * VimText on the pinned Quill 2.0.3 build (#55, ADR 0008) through the built
 * extension: real keys, Quill's own model read back (`modelText`, and
 * `quillDoc` for its formats; see tests/fixtures/quill.ts), never the DOM.
 * Quill reads every write through its MutationObserver
 * (docs/research/editor-write-paths.md, "Quill"). After each write a real
 * keystroke in Insert shows the write survived in the model.
 */

const HOST = "#editor .ql-editor";
const EMBED = "￼";

const ORIGINAL = [
  "the quick brown fox",
  "a heading",
  "first item",
  "second item",
  `a cat ${EMBED} here`,
  "last line",
];

function quillDoc(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { quillDoc(): string[] }).quillDoc());
}

test.beforeEach(async ({ page }) => {
  await page.goto("/quill.html");
  await ready(page);
  await activateAtStart(page, HOST);
});

test("the fixture's model reads back one line per block", async ({ page }) => {
  await expect.poll(() => modelText(page)).toEqual(ORIGINAL);
  await expect
    .poll(() => quillDoc(page))
    .toEqual([
      "the <b>quick brown</b> fox",
      "h1:a heading",
      "bullet:first item",
      "bullet:second item",
      `a cat ${EMBED} here`,
      "last line",
    ]);
});

/** Insert `text` with real keys at the cursor and go back to Normal: Quill's own input after VimText's write. */
async function typeAfter(page: Page, text: string): Promise<void> {
  await page.keyboard.type("i");
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
}

test("x r cw inside the bold run keep it bold; dw across its edge trims both sides", async ({ page }) => {
  await page.keyboard.type("wx");
  await expect.poll(async () => (await quillDoc(page))[0]).toBe("the <b>uick brown</b> fox");
  await page.keyboard.type("lrX");
  await expect.poll(async () => (await quillDoc(page))[0]).toBe("the <b>uXck brown</b> fox");
  await page.keyboard.type("wcw");
  await page.keyboard.type("lazy");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await quillDoc(page))[0]).toBe("the <b>uXck lazy</b> fox");
  await typeAfter(page, "!");
  await expect.poll(async () => (await modelText(page))[0]).toBe("the uXck laz!y fox");
  // dw from "the" removes the plain word and its space; the bold run keeps its marks.
  await page.keyboard.type("0dw");
  await expect.poll(async () => (await quillDoc(page))[0]).toBe("<b>uXck laz!y</b> fox");
  await typeAfter(page, "A");
  await expect.poll(async () => (await modelText(page))[0]).toBe("AuXck laz!y fox");
  await expect.poll(async () => (await modelText(page)).slice(1)).toEqual(ORIGINAL.slice(1));
});

/**
 * #63: `cw` on the first word of a bold run. The owner decision puts the
 * Insert caret in the run that held the deleted word, the start of the bold
 * ` brown`, and that is where VimText sets it; but Quill leaves a collapsed
 * insertion to Chromium, typed or written, and Chromium's `insertText` at a
 * boundary between two text nodes takes the style before it wherever the
 * caret was set (tests/unit/chromium-facts.test.ts, "Marks at a write's
 * edges"). So the typed word is plain. Pinned as found: the decision's
 * deleted-text side is out of reach on an editor that lets Chromium type.
 */
test("cw on the first word of the bold run types plain: Chromium types in the style before the run (#63)", async ({
  page,
}) => {
  await page.keyboard.type("wcw");
  await page.keyboard.type("QUICK");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await quillDoc(page))[0]).toBe("the QUICK<b> brown</b> fox");
});

test("dw on a whole bold word deletes it; the cursor stays where Vim puts it (#59)", async ({ page }) => {
  await page.keyboard.type("wdw");
  await expect.poll(async () => (await quillDoc(page))[0]).toBe("the <b>brown</b> fox");
  await page.keyboard.type("dw");
  await expect.poll(async () => (await quillDoc(page))[0]).toBe("the fox");
  await expect.poll(async () => (await modelText(page)).slice(1)).toEqual(ORIGINAL.slice(1));
  // #59: Quill merges `the ` and ` fox` into one text node a microtask after
  // the write, which collapses the native selection. The selection is set once
  // the write has settled (#52, ADR 0008), so the cursor stays on `f` and the
  // next `dw` deletes `fox`.
  await page.keyboard.type("dw");
  await expect.poll(async () => (await modelText(page))[0]).toBe("the ");
});

test("dd removes a block from Quill's model; a real keystroke after it lands at the cursor", async ({
  page,
}) => {
  await page.keyboard.type("dd");
  // The header's text moves into the first line's <p> and loses its format: the
  // same text, other markup (docs/engine-seams.md, "Block merges and splits").
  await expect
    .poll(() => quillDoc(page))
    .toEqual(["a heading", "bullet:first item", "bullet:second item", `a cat ${EMBED} here`, "last line"]);
  await typeAfter(page, "Z");
  await expect.poll(async () => (await modelText(page))[0]).toBe("Za heading");
  await page.keyboard.type("Gdd");
  await expect
    .poll(() => modelText(page))
    .toEqual(["Za heading", "first item", "second item", `a cat ${EMBED} here`]);
  await typeAfter(page, "Q");
  await expect.poll(async () => (await modelText(page))[3]).toBe(`Qa cat ${EMBED} here`);
});

test("J and a Visual delete across lines merge Quill's blocks; a real keystroke after each keeps them", async ({
  page,
}) => {
  // The heading's text joins the paragraph above it. `J` writes one
  // `insertText(' ')` over the line break, which Quill's Input module takes
  // from the synthetic `beforeinput` (ADR 0008) and applies as a Delta: the
  // first line's `\n` goes, so the joined line keeps the heading's line
  // format, as typing a space over a selection across the two lines does.
  // (Under `execCommand` alone it kept the paragraph's.)
  await page.keyboard.type("J");
  await expect
    .poll(() => quillDoc(page))
    .toEqual([
      "h1:the <b>quick brown</b> fox a heading",
      "bullet:first item",
      "bullet:second item",
      `a cat ${EMBED} here`,
      "last line",
    ]);
  await typeAfter(page, ",");
  await expect.poll(async () => (await modelText(page))[0]).toBe("the quick brown fox, a heading");
  // From `cat` on the embed's line to `t` and the space after it on the last line, inclusive.
  await page.keyboard.type("Gkwvjlld");
  await expect.poll(async () => (await modelText(page)).slice(3)).toEqual(["a line"]);
  await typeAfter(page, "Y");
  await expect
    .poll(() => modelText(page))
    .toEqual(["the quick brown fox, a heading", "first item", "second item", "a Yline"]);
});

test("o and linewise p open a new block below; r<CR> splits a line without losing text", async ({ page }) => {
  await page.keyboard.type("o");
  await page.keyboard.type("new para");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => quillDoc(page))
    .toEqual([
      "the <b>quick brown</b> fox",
      "new para",
      "h1:a heading",
      "bullet:first item",
      "bullet:second item",
      `a cat ${EMBED} here`,
      "last line",
    ]);
  // Registers hold plain text: the pasted line is not bold.
  await page.keyboard.type("ggyyGp");
  await expect
    .poll(async () => (await quillDoc(page)).slice(6))
    .toEqual(["last line", "the quick brown fox"]);
  await typeAfter(page, ">");
  await expect.poll(async () => (await modelText(page))[7]).toBe(">the quick brown fox");
  // r<CR> on the `b` of the bold `brown`: both halves stay bold.
  await page.keyboard.type("ggwwr\n");
  await expect
    .poll(async () => (await quillDoc(page)).slice(0, 2))
    .toEqual(["the <b>quick </b>", "<b>rown</b> fox"]);
  await typeAfter(page, "B");
  await expect
    .poll(async () => (await modelText(page)).slice(0, 3))
    .toEqual(["the quick ", "Brown fox", "new para"]);
});

test("o on a list item opens a list item; o on a header opens a plain line, as Enter there does", async ({
  page,
}) => {
  await page.keyboard.type("jjo");
  await page.keyboard.type("new item");
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await quillDoc(page)).slice(2, 5))
    .toEqual(["bullet:first item", "bullet:new item", "bullet:second item"]);
  await page.keyboard.type("jo");
  await page.keyboard.type("last item");
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await quillDoc(page)).slice(4, 7))
    .toEqual(["bullet:second item", "bullet:last item", `a cat ${EMBED} here`]);
  await page.keyboard.type("ggjo");
  await page.keyboard.type("body");
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await quillDoc(page)).slice(1, 4))
    .toEqual(["h1:a heading", "body", "bullet:first item"]);
});

test("a linewise p below a header, or P on the line below it, keeps the pasted line (#61)", async ({
  page,
}) => {
  // Chromium's insertParagraph at the end of an <h1> makes a <div>, which
  // Quill replaces with a <p> of its own; the pasted text goes on that new
  // line, where the projection puts it, wherever Quill's re-render left the
  // caret. `P` on the line below writes the same `\n` + text at the heading's
  // end (docs/engine-seams.md, "Linewise writes").
  const pasted = [ORIGINAL[0]!, ORIGINAL[1]!, ORIGINAL[0]!, ...ORIGINAL.slice(2)];
  await page.keyboard.type("yyjp");
  await expect.poll(() => modelText(page)).toEqual(pasted);
  await typeAfter(page, ">");
  await expect.poll(async () => (await modelText(page))[2]).toBe(">the quick brown fox");
  await page.keyboard.type("uu");
  await expect.poll(() => modelText(page)).toEqual(ORIGINAL);
  await page.keyboard.type("ggjjP");
  await expect.poll(() => modelText(page)).toEqual(pasted);
  await expect.poll(async () => (await quillDoc(page))[1]).toBe("h1:a heading");
});

test("a list item's marker is no text of its line: 0x, I, dd and J act on a list item as on a plain line (#60)", async ({
  page,
}) => {
  // Each list item starts with Quill's empty <span class="ql-ui"
  // contenteditable="false">, which draws the bullet. It is decoration, not an
  // Atom (DESIGN.md, _Atoms_), so the line starts at the item's text.
  await page.keyboard.type("jjjI");
  await page.keyboard.type("Z");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await modelText(page))[3]).toBe("Zsecond item");
  await page.keyboard.type("k0x");
  await expect.poll(async () => (await modelText(page))[2]).toBe("irst item");
  await page.keyboard.type("x");
  await expect.poll(async () => (await modelText(page))[2]).toBe("rst item");
  await typeAfter(page, "f");
  await expect.poll(async () => (await modelText(page))[2]).toBe("frst item");
  expect(await statusText(page)).not.toContain("refused");
  // J joins the two items into one.
  await page.keyboard.type("J");
  await expect
    .poll(async () => (await quillDoc(page)).slice(2, 4))
    .toEqual(["bullet:frst item Zsecond item", `a cat ${EMBED} here`]);
  // dd removes the item whole, marker and all.
  await page.keyboard.type("dd");
  await expect
    .poll(() => quillDoc(page))
    .toEqual(["the <b>quick brown</b> fox", "h1:a heading", `a cat ${EMBED} here`, "last line"]);
  await typeAfter(page, "Q");
  await expect.poll(async () => (await modelText(page))[2]).toBe(`Qa cat ${EMBED} here`);
});

test("x on the embed deletes it and u restores it; the next keystroke lands at the cursor", async ({
  page,
}) => {
  await page.keyboard.type("4jwwx");
  await expect.poll(async () => (await modelText(page))[4]).toBe("a cat  here");
  await page.keyboard.type("u");
  await expect.poll(() => modelText(page)).toEqual(ORIGINAL);
  await typeAfter(page, "big ");
  await expect.poll(async () => (await modelText(page))[4]).toBe(`a cat big ${EMBED} here`);
});

test("u and Ctrl-r restore Quill's text", async ({ page }) => {
  await page.keyboard.type("wx");
  await page.keyboard.type("jdd");
  await page.keyboard.type("Gdd");
  await expect
    .poll(() => modelText(page))
    .toEqual(["the uick brown fox", "first item", "second item", `a cat ${EMBED} here`]);
  const edited = await modelText(page);
  await page.keyboard.type("uuu");
  await expect.poll(() => modelText(page)).toEqual(ORIGINAL);
  await page.keyboard.press("Control+r");
  await page.keyboard.press("Control+r");
  await page.keyboard.press("Control+r");
  await expect.poll(() => modelText(page)).toEqual(edited);
  await page.keyboard.type("u");
  await expect.poll(() => modelText(page)).toEqual(["the uick brown fox", ...ORIGINAL.slice(2)]);
});

test.describe("a formatting shortcut pressed while a write is being applied (#72)", () => {
  const KEYS = [
    "o",
    "n",
    "e",
    " ",
    "ControlOrMeta+b",
    "t",
    "w",
    "o",
    "ControlOrMeta+b",
    " ",
    "t",
    "h",
    "r",
    "e",
    "e",
  ];

  test("accepted limitation: Cmd+B pressed back to back after G A Enter applies to nothing; the line is typed plain", async ({
    page,
  }) => {
    // Pins an accepted limitation (DESIGN.md, "Accepted limitations", #72), not
    // a wanted behaviour. The keys land while the caret move's write is still
    // being applied: the characters go into the mirror and land with the merged
    // write as plain text, while Cmd+B reaches Quill at a moment when nothing
    // typed is there yet, so `two` is not bold. On a quiet machine every key
    // lands before the first piece of the write does; on a heavily loaded one
    // the write can land in pieces and a Cmd+B between two of them applies at
    // Quill's caret as it then stands (seen: the whole line bold), which this
    // test does not cover.
    for (const k of ["G", "A", "Enter", ...KEYS, "Escape"]) await page.keyboard.press(k);
    await expect.poll(async () => (await quillDoc(page)).slice(5)).toEqual(["last line", "one two three"]);
  });

  test("Cmd+B pressed once the write has landed bolds what is typed after it", async ({ page }) => {
    for (const k of ["G", "A", "Enter"]) await page.keyboard.press(k);
    // The new empty line is in Quill's model: the write has been applied. The
    // pause lets the caret VimText set settle too (#64), so the keys after it
    // are the person's own, as typed at a normal pace (150 ms, as in triage).
    await expect.poll(async () => (await modelText(page)).slice(5)).toEqual(["last line", ""]);
    await page.waitForTimeout(150);
    for (const k of [...KEYS, "Escape"]) await page.keyboard.press(k);
    await expect
      .poll(async () => (await quillDoc(page)).slice(5))
      .toEqual(["last line", "one <b>two</b> three"]);
  });
});
