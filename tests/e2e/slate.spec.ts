import { test, expect, ready, activateAtStart, modelText } from "./extension";
import type { Page } from "@playwright/test";

/**
 * VimText on the pinned Slate build (slate 0.147.4, slate-react 0.147.5,
 * slate-history 0.144.0; #54, ADR 0008) through the built extension: real
 * keys, Slate's own model read back (`modelText`, and `slateDoc` for its
 * marks; see tests/fixtures/slate.ts), never the DOM. Slate takes its edits
 * only from `beforeinput` and never reads the DOM back, so under `execCommand`
 * alone every write was a Diverged Edit its next render silently put back
 * (docs/research/editor-write-paths.md, "Slate"). Each write step now offers
 * the edit as a synthetic `beforeinput`, which Slate takes over. After each
 * write a real keystroke in Insert, in the same block, shows the write
 * survived in the model.
 */

const HOST = "#editor";

const ORIGINAL = ["the quick brown fox", "a heading", "first item", "second item", "last line"];

function slateDoc(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { slateDoc(): string[] }).slateDoc());
}

function slateUndos(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { slateUndos(): number }).slateUndos());
}

test.beforeEach(async ({ page }) => {
  await page.goto("/slate.html");
  await ready(page);
  await activateAtStart(page, HOST);
});

test("the fixture's model reads back one line per block", async ({ page }) => {
  await expect.poll(() => modelText(page)).toEqual(ORIGINAL);
  await expect
    .poll(() => slateDoc(page))
    .toEqual(["the <b>quick brown</b> fox", "h1:a heading", "li:first item", "li:second item", "last line"]);
});

/** Insert `text` with real keys at the cursor and go back to Normal: Slate's own input after VimText's write. */
async function typeAfter(page: Page, text: string): Promise<void> {
  await page.keyboard.type("i");
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
}

test("x r cw inside the bold run keep it bold; dw across its edge trims both sides", async ({ page }) => {
  await page.keyboard.type("wx");
  await expect.poll(async () => (await slateDoc(page))[0]).toBe("the <b>uick brown</b> fox");
  await page.keyboard.type("lrX");
  await expect.poll(async () => (await slateDoc(page))[0]).toBe("the <b>uXck brown</b> fox");
  await page.keyboard.type("wcw");
  await page.keyboard.type("lazy");
  await page.keyboard.press("Escape");
  // `cw` on `brown`, the bold run's last word: `lazy` goes in the run that
  // held `brown` (owner decision on #63). Typed right after `cw`, it reaches
  // Slate as a write on the side of the boundary that held `brown`, and Slate
  // types into the leaf that write names (red on main, which wrote it at the
  // start of ` fox`). A key typed later is Chromium's own and takes the style
  // before the boundary, the same outcome. Each path pinned deterministically:
  // tests/unit/contenteditable-field.test.ts, "text typed while a deletion at
  // a run's end settles is written in that run"; tests/unit/chromium-facts.test.ts,
  // "Marks at a write's edges".
  await expect.poll(async () => (await slateDoc(page))[0]).toBe("the <b>uXck lazy</b> fox");
  await typeAfter(page, "!");
  await expect.poll(async () => (await modelText(page))[0]).toBe("the uXck laz!y fox");
  await page.keyboard.type("0dw");
  await expect.poll(async () => (await slateDoc(page))[0]).toBe("<b>uXck laz!y</b> fox");
  await typeAfter(page, "A");
  await expect.poll(async () => (await modelText(page))[0]).toBe("AuXck laz!y fox");
  await expect.poll(async () => (await modelText(page)).slice(1)).toEqual(ORIGINAL.slice(1));
});

/**
 * Owner decision on #63, with nothing deleted: the Insert caret on a run's
 * edge takes the side before it, as native typing there would. Typed right
 * after `a` or `i`, the key reaches Slate as a write while the caret settles
 * (`Session.typeWhileWriting`), at the caret's side (red on main, which wrote
 * it at the start of the run after); typed later, Chromium's own typing takes
 * the style before the boundary, the same outcome. Each path pinned
 * deterministically: tests/unit/contenteditable-field.test.ts, "text typed
 * while the caret settles is written on the caret's side";
 * tests/unit/chromium-facts.test.ts, "Marks at a write's edges".
 */
test("a at the end of the bold run types bold; i on its first character types plain", async ({ page }) => {
  await page.keyboard.type("wwea");
  await page.keyboard.type("S");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await slateDoc(page))[0]).toBe("the <b>quick brownS</b> fox");
  await page.keyboard.type("0wi");
  await page.keyboard.type("Y");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await slateDoc(page))[0]).toBe("the Y<b>quick brownS</b> fox");
});

test("r and cw across the bold run's edge replace text on both sides of it", async ({ page }) => {
  await page.keyboard.type("c2w");
  await page.keyboard.type("one");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await modelText(page))[0]).toBe("one brown fox");
  await typeAfter(page, "!");
  await expect.poll(async () => (await modelText(page))[0]).toBe("on!e brown fox");
  await page.keyboard.type("l3rZ");
  await expect.poll(async () => (await modelText(page))[0]).toBe("on!ZZZrown fox");
  await typeAfter(page, "<");
  await expect.poll(async () => (await modelText(page))[0]).toBe("on!ZZ<Zrown fox");
  await expect.poll(async () => (await modelText(page)).slice(1)).toEqual(ORIGINAL.slice(1));
});

test("dw on a whole bold word deletes it", async ({ page }) => {
  await page.keyboard.type("wdw");
  await expect.poll(async () => (await slateDoc(page))[0]).toBe("the <b>brown</b> fox");
  await page.keyboard.type("dw");
  await expect.poll(async () => (await modelText(page))[0]).toBe("the fox");
  await typeAfter(page, "big ");
  await expect.poll(async () => (await modelText(page))[0]).toBe("the big fox");
  await expect.poll(async () => (await modelText(page)).slice(1)).toEqual(ORIGINAL.slice(1));
});

test("dd removes a block from Slate's model; a real keystroke after it lands at the cursor", async ({
  page,
}) => {
  await page.keyboard.type("dd");
  await expect.poll(() => modelText(page)).toEqual(ORIGINAL.slice(1));
  await typeAfter(page, "Z");
  await expect.poll(async () => (await modelText(page))[0]).toBe("Za heading");
  await page.keyboard.type("Gdd");
  await expect.poll(() => modelText(page)).toEqual(["Za heading", "first item", "second item"]);
  await typeAfter(page, "Q");
  await expect.poll(async () => (await modelText(page))[2]).toBe("Qsecond item");
});

/**
 * `J` is a boundary delete Slate takes over, then the joining space: in the
 * spike, with no task between the two steps, the space went to DOM Slate had
 * not re-rendered yet, which duplicated the joined line and threw a React
 * `removeChild` error (`ContentEditableField.pause`).
 */
test("J joins Slate's blocks and a Visual delete across lines merges them; a real keystroke after each keeps them", async ({
  page,
}) => {
  await page.keyboard.type("J");
  await expect
    .poll(() => modelText(page))
    .toEqual(["the quick brown fox a heading", "first item", "second item", "last line"]);
  await typeAfter(page, ",");
  await expect.poll(async () => (await modelText(page))[0]).toBe("the quick brown fox, a heading");
  // From `item` on the second item to the `n` under it on the last line, inclusive.
  await page.keyboard.type("Gkwvjd");
  await expect.poll(async () => (await modelText(page)).slice(1)).toEqual(["first item", "second e"]);
  await typeAfter(page, "Y");
  await expect
    .poll(() => modelText(page))
    .toEqual(["the quick brown fox, a heading", "first item", "second Ye"]);
});

test("o and linewise p open a new block below; r<CR> splits a line without losing text", async ({ page }) => {
  await page.keyboard.type("o");
  await page.keyboard.type("new para");
  await page.keyboard.press("Escape");
  await expect.poll(() => modelText(page)).toEqual(["the quick brown fox", "new para", ...ORIGINAL.slice(1)]);
  await typeAfter(page, "!");
  await expect.poll(async () => (await modelText(page))[1]).toBe("new par!a");
  await page.keyboard.type("ggyyGp");
  await expect
    .poll(async () => (await modelText(page)).slice(5))
    .toEqual(["last line", "the quick brown fox"]);
  await typeAfter(page, ">");
  await expect.poll(async () => (await modelText(page))[6]).toBe(">the quick brown fox");
  await page.keyboard.type("ggwwr\n");
  await expect
    .poll(async () => (await modelText(page)).slice(0, 3))
    .toEqual(["the quick ", "rown fox", "new par!a"]);
  await typeAfter(page, "B");
  await expect
    .poll(async () => (await modelText(page)).slice(0, 3))
    .toEqual(["the quick ", "Brown fox", "new par!a"]);
});

/**
 * Writes back to back: a count, `.` and a macro typed as fast as Playwright
 * types make each write follow the one before with no key's worth of time
 * between them, and a macro that edits two lines makes one write of two
 * spans. Slate ignores `selectionchange` for a while after it renders, so
 * each span waits before it selects (`WRITE_GAP_MS` in ContentEditableField).
 */
test("3x then . and a macro that edits two lines land every write", async ({ page }) => {
  await page.keyboard.type("3x.");
  await expect.poll(async () => (await modelText(page))[0]).toBe("ick brown fox");
  await typeAfter(page, "Q");
  await expect.poll(async () => (await modelText(page))[0]).toBe("Qick brown fox");
  await page.keyboard.type("jqaxjxkq");
  await expect.poll(async () => (await modelText(page)).slice(1, 3)).toEqual([" heading", "irst item"]);
  await page.keyboard.type("@a");
  await expect.poll(async () => (await modelText(page)).slice(1, 3)).toEqual(["heading", "rst item"]);
  await page.keyboard.type("jdd.");
  await expect.poll(() => modelText(page)).toEqual(["Qick brown fox", "heading", "last line"]);
  await typeAfter(page, "Z");
  await expect.poll(() => modelText(page)).toEqual(["Qick brown fox", "heading", "Zlast line"]);
});

test("Slate's own history has entries for VimText's writes, and its undo restores the text", async ({
  page,
}) => {
  await page.keyboard.type("wx");
  await page.keyboard.type("jdd");
  await page.keyboard.type("o");
  await page.keyboard.type("new");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => modelText(page))
    .toEqual(["the uick brown fox", "first item", "new", "second item", "last line"]);
  expect(await slateUndos(page)).toBeGreaterThan(0);
  await page.evaluate(() => (window as unknown as { slateUndoAll(): void }).slateUndoAll());
  await expect.poll(() => modelText(page)).toEqual(ORIGINAL);
});

test("u and Ctrl-r restore Slate's text", async ({ page }) => {
  await page.keyboard.type("wx");
  await page.keyboard.type("jdd");
  await page.keyboard.type("Gdd");
  await expect.poll(() => modelText(page)).toEqual(["the uick brown fox", "first item", "second item"]);
  const edited = await modelText(page);
  await page.keyboard.type("uuu");
  await expect.poll(() => modelText(page)).toEqual(ORIGINAL);
  await page.keyboard.press("Control+r");
  await page.keyboard.press("Control+r");
  await page.keyboard.press("Control+r");
  await expect.poll(() => modelText(page)).toEqual(edited);
  await page.keyboard.type("u");
  await expect.poll(() => modelText(page)).toEqual(["the uick brown fox", ...ORIGINAL.slice(2)]);
  await page.keyboard.type("G");
  await typeAfter(page, "Z");
  await expect.poll(async () => (await modelText(page))[3]).toBe("Zlast line");
});

/**
 * Why a write's deletion is offered as `deleteContentBackward` (ADR 0008):
 * Slate cancels a synthetic `deleteContent` and does nothing, so offered that,
 * a delete would be dropped (docs/engine-seams.md, "deleteContent is
 * dropped"). A bare-page probe on the fixture, no VimText key involved.
 */
test("Slate cancels a synthetic deleteContent and does nothing; deleteContentBackward deletes", async ({
  page,
}) => {
  const offer = (inputType: string) =>
    page.evaluate(async (type) => {
      const host = document.getElementById("editor")!;
      // `last line`, Slate's text node inside its <span data-slate-string>.
      const text = host.querySelector("p:last-child [data-slate-string]")!.firstChild!;
      document.getSelection()!.setBaseAndExtent(text, 0, text, 5);
      document.dispatchEvent(new Event("selectionchange"));
      // Slate takes the selection on its throttled handler.
      await new Promise((r) => setTimeout(r, 150));
      const range = new StaticRange({
        startContainer: text,
        startOffset: 0,
        endContainer: text,
        endOffset: 5,
      });
      const event = new InputEvent("beforeinput", {
        inputType: type,
        bubbles: true,
        cancelable: true,
        composed: true,
        targetRanges: [range],
      });
      host.dispatchEvent(event);
      await new Promise((r) => setTimeout(r, 50));
      return event.defaultPrevented;
    }, inputType);
  expect(await offer("deleteContent")).toBe(true);
  expect((await modelText(page))[4]).toBe("last line");
  expect(await offer("deleteContentBackward")).toBe(true);
  await expect.poll(async () => (await modelText(page))[4]).toBe("line");
});
