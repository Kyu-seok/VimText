import { test, expect, statusText, ready, activateAtStart } from "./extension";
import type { Page } from "@playwright/test";

/**
 * The M4 dogfooding steps (docs/release.md, "M4: contenteditable editors") over
 * the real sites' editor markup, copied into tests/fixtures/site-shapes.html:
 * each host is a shape that broke VimText on a live site and no library
 * fixture had. A step fails on a refused edit or on text that did not land.
 *
 * The burst tests press their keys back to back, the way a person typing fast
 * (or an agent's browser tool) does, so the keys land while VimText's write or
 * caret is still settling (ADR 0008). Reading the page between those keys hides
 * what they catch (#68).
 */

const REFUSED = "refused the edit";

test.beforeEach(async ({ page }) => {
  await page.goto("/site-shapes.html");
  await ready(page);
});

/**
 * The host's lines as they render, blank lines included: each character, and
 * each `<br>`, goes to the line box it is drawn on (no fixture line wraps), so
 * neither `innerText`'s blank lines beside a `<p>` or a `<br>` before a nested
 * block (docs/engine-seams.md, "innerText as the oracle") nor a dropped empty
 * line (#67's class) slips by. A U+FEFF draws nothing but holds its line.
 */
function lines(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluate((host: HTMLElement) => {
    const byTop = new Map<number, string>();
    const add = (top: number, text: string) => {
      const key = [...byTop.keys()].find((k) => Math.abs(k - top) < 2) ?? top;
      byTop.set(key, (byTop.get(key) ?? "") + text);
    };
    const walker = host.ownerDocument.createTreeWalker(host, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    const range = host.ownerDocument.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n instanceof HTMLBRElement) {
        const r = n.getBoundingClientRect();
        if (r.height) add(r.top, "");
      } else if (n instanceof Text) {
        for (let i = 0; i < n.data.length; i++) {
          if (n.data[i] === "\n") continue;
          range.setStart(n, i);
          range.setEnd(n, i + 1);
          const r = range.getClientRects()[0];
          if (r) add(r.top, n.data[i] === "\ufeff" ? "" : n.data[i] === "\u00a0" ? " " : n.data[i]!);
        }
      }
    }
    return [...byTop.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t);
  });
}

/** Presses each key with no wait between them. */
async function burst(page: Page, keys: string[]): Promise<void> {
  for (const k of keys) await page.keyboard.press(k);
}

async function notRefused(page: Page): Promise<void> {
  expect(await statusText(page)).not.toContain(REFUSED);
}

/** Polls until the host's rendered lines are one of `outcomes`: a burst whose Enter may land as the person's own key or as a write. */
async function linesOneOf(page: Page, selector: string, outcomes: string[][]): Promise<void> {
  const want = outcomes.map((o) => JSON.stringify(o));
  await expect
    .poll(async () => {
      const got = JSON.stringify(await lines(page, selector));
      return want.includes(got) ? "one of the outcomes" : got;
    })
    .toBe("one of the outcomes");
}

/**
 * The runbook's repeat, undo and leave steps (docs/release.md, "M4"): `3x`,
 * `.`, `u`, Ctrl-r, then from Insert one Esc and `:q`. `first` reads the line
 * the cursor starts on; `afterX` and `afterDot` are it after `3x` and `.`.
 * `:q` keeps the text, hides the Status Line and gives focus back to the page.
 */
async function repeatUndoLeave(
  page: Page,
  first: () => Promise<string | undefined>,
  [afterX, afterDot]: [string, string],
  focused: string,
): Promise<void> {
  await page.keyboard.type("3x");
  await expect.poll(first).toBe(afterX);
  await page.keyboard.type(".");
  await expect.poll(first).toBe(afterDot);
  await page.keyboard.type("u");
  await expect.poll(first).toBe(afterX);
  await page.keyboard.press("Control+r");
  await expect.poll(first).toBe(afterDot);
  await notRefused(page);
  await page.keyboard.type("i");
  await page.keyboard.press("Escape");
  await page.keyboard.type(":q");
  await page.keyboard.press("Enter");
  await expect.poll(() => statusText(page)).toBe("");
  await expect(page.locator(focused)).not.toBeFocused();
  expect(await first()).toBe(afterDot);
}

test.describe("Gmail compose body: a bare text first line above <div> lines", () => {
  const ORIGINAL = ["alpha beta gamma", "delta bold run epsilon", "zeta eta theta"];

  test.beforeEach(async ({ page }) => activateAtStart(page, "#gmail"));

  test("o on the first line opens a line and dd takes that line (#67)", async ({ page }) => {
    await page.keyboard.type("ggonew");
    await page.keyboard.press("Escape");
    await expect.poll(() => lines(page, "#gmail")).toEqual(["alpha beta gamma", "new", ...ORIGINAL.slice(1)]);
    await notRefused(page);
    await page.keyboard.type("dd");
    await expect.poll(() => lines(page, "#gmail")).toEqual(ORIGINAL);
    await notRefused(page);
  });

  test("J then u leaves nested <div>s; o there still opens a line (#67)", async ({ page }) => {
    await page.keyboard.type("ggJ");
    await expect
      .poll(() => lines(page, "#gmail"))
      .toEqual(["alpha beta gamma delta bold run epsilon", "zeta eta theta"]);
    await page.keyboard.type("u");
    await expect.poll(() => lines(page, "#gmail")).toEqual(ORIGINAL);
    await page.keyboard.type("jox");
    await page.keyboard.press("Escape");
    await expect.poll(() => lines(page, "#gmail")).toEqual([...ORIGINAL.slice(0, 2), "x", ORIGINAL[2]]);
    await notRefused(page);
  });

  test("o then Esc leaves an empty line, and u takes it back (#67)", async ({ page }) => {
    await page.keyboard.type("ggo");
    await page.keyboard.press("Escape");
    await expect.poll(() => lines(page, "#gmail")).toEqual([ORIGINAL[0], "", ...ORIGINAL.slice(1)]);
    await notRefused(page);
    await page.keyboard.type("u");
    await expect.poll(() => lines(page, "#gmail")).toEqual(ORIGINAL);
    await notRefused(page);
  });

  test("cw inside the bold run keeps it bold", async ({ page }) => {
    await page.keyboard.type("ggj0wwcwwalk");
    await page.keyboard.press("Escape");
    await expect.poll(() => page.locator("#gmail b").textContent()).toBe("bold walk");
    await notRefused(page);
  });

  test("3x, ., u, Ctrl-r and :q", async ({ page }) => {
    await repeatUndoLeave(
      page,
      () => lines(page, "#gmail").then((l) => l[0]),
      ["ha beta gamma", "beta gamma"],
      "#gmail",
    );
    expect(await lines(page, "#gmail")).toEqual(["beta gamma", ...ORIGINAL.slice(1)]);
  });

  test("burst: A, Enter, text and Esc back to back keep the text", async ({ page }) => {
    await burst(page, ["G", "A", "Enter", "o", "n", "e", "Escape"]);
    await expect.poll(() => lines(page, "#gmail")).toEqual([...ORIGINAL, "one"]);
    await notRefused(page);
  });
});

test.describe("Slack message box: a line holding only Quill's U+FEFF cursor blot", () => {
  test.beforeEach(async ({ page }) => activateAtStart(page, "#slack"));

  test("G lands on the blot's line and A types there (#68)", async ({ page }) => {
    await page.keyboard.type("GAnew");
    await page.keyboard.press("Escape");
    await expect
      .poll(() => lines(page, "#slack"))
      .toEqual(["alpha beta gamma", "delta bold run epsilon", "zeta eta theta", "new"]);
    await notRefused(page);
  });

  test("burst: k A, Shift+Enter, text and Esc back to back keep the text, the break kept or refused (#68)", async ({
    page,
  }) => {
    await burst(page, ["G", "k", "A", "Shift+Enter", "o", "n", "e", "Escape"]);
    // Shift+Enter is the person's own key when the caret has settled, and a
    // write Slack refuses when it has not: either way the text stays.
    await linesOneOf(page, "#slack", [
      ["alpha beta gamma", "delta bold run epsilon", "zeta eta theta", "one", ""],
      ["alpha beta gamma", "delta bold run epsilon", "zeta eta thetaone", ""],
    ]);
  });

  test("burst: A, Enter, text and Esc back to back keep the text on its line and the empty line below, the break kept or refused (#68, #73)", async ({
    page,
  }) => {
    // Unlike Shift+Enter, an Enter typed while the caret settles is written as
    // a paragraph break, which the shape refuses as Slack does.
    await burst(page, ["G", "k", "A", "Enter", "o", "n", "e", "Escape"]);
    // Mostly written and refused (#73: the typing once landed on the empty
    // line below); under load sometimes the person's own key.
    await linesOneOf(page, "#slack", [
      ["alpha beta gamma", "delta bold run epsilon", "zeta eta thetaone", ""],
      ["alpha beta gamma", "delta bold run epsilon", "zeta eta theta", "one", ""],
    ]);
  });

  test("cw inside the bold run keeps it bold", async ({ page }) => {
    await page.keyboard.type("ggj0wwcwwalk");
    await page.keyboard.press("Escape");
    await expect.poll(() => page.locator("#slack strong").first().textContent()).toBe("bold walk");
    await notRefused(page);
  });

  test("3x, ., u, Ctrl-r and :q", async ({ page }) => {
    await repeatUndoLeave(
      page,
      () => lines(page, "#slack").then((l) => l[0]),
      ["ha beta gamma", "beta gamma"],
      "#slack",
    );
    expect(await lines(page, "#slack")).toEqual([
      "beta gamma",
      "delta bold run epsilon",
      "zeta eta theta",
      "",
    ]);
  });
});

test.describe("Notion page: blocks marked contenteditable inside one editable root", () => {
  /** Focus stays on the root, as on Notion; the caret goes into block `#n-two`. */
  test.beforeEach(async ({ page }) => {
    await page.locator("#notion").focus();
    await page
      .locator("#n-two")
      .evaluate((el) => el.ownerDocument.getSelection()!.collapse(el.firstChild, 0));
    await page.keyboard.press("Escape");
    await expect.poll(() => statusText(page)).toContain("NORMAL");
  });

  test("motions and edits stay inside the block with the caret (#69)", async ({ page }) => {
    await page.keyboard.type("kkkJ");
    await expect.poll(() => page.locator("#n-two").innerText()).toBe("line one line two\nline three");
    await page.keyboard.type("Gdd");
    await expect.poll(() => page.locator("#n-two").innerText()).toBe("line one line two");
    expect(await page.locator("#n-one").innerText()).toBe("alpha beta gamma");
    expect(await page.locator("#n-title").innerText()).toBe("Scratch");
    expect(await page.locator("#notion .controls").innerText()).toBe("Add icon Add cover");
    await notRefused(page);
  });

  test("burst: A, Enter, text and Esc back to back keep the text, the break kept or refused (#68)", async ({
    page,
  }) => {
    await burst(page, ["G", "A", "Enter", "f", "a", "s", "t", "Escape"]);
    // Mostly the Enter is written and refused; under load it is sometimes the
    // person's own key, splitting the block. The refused path is pinned in
    // async-write.test.ts.
    const page_ = ["Add icon Add cover", "Scratch", "alpha beta gamma", "line one", "line two"];
    await linesOneOf(page, "#notion", [
      [...page_, "line threefast"],
      [...page_, "line three", "fast"],
    ]);
    expect(await page.locator("#n-one").innerText()).toBe("alpha beta gamma");
  });

  test("cw changes a word in the block", async ({ page }) => {
    await page.keyboard.type("wcwtwo");
    await page.keyboard.press("Escape");
    await expect.poll(() => lines(page, "#n-two")).toEqual(["line two", "line two", "line three"]);
    await notRefused(page);
  });

  test("3x, ., u, Ctrl-r and :q", async ({ page }) => {
    await repeatUndoLeave(page, () => lines(page, "#n-two").then((l) => l[0]), ["e one", "ne"], "#notion");
    expect(await lines(page, "#n-two")).toEqual(["ne", "line two", "line three"]);
    expect(await page.locator("#n-one").innerText()).toBe("alpha beta gamma");
  });

  test("a refused u of J and a refused o keep no text no one typed (#73)", async ({ page }) => {
    const JOINED = "line one line two\nline three";
    await page.keyboard.type("kkkJ");
    await expect.poll(() => page.locator("#n-two").innerText()).toBe(JOINED);
    await page.keyboard.type("u");
    await expect.poll(() => statusText(page)).toContain(REFUSED);
    expect(await page.locator("#n-two").innerText()).toBe(JOINED);
    // A key typed once the refused `o` has settled is the person's own, typed
    // into the page; one typed while it is pending is unit-tested
    // (async-write.test.ts, "a refused o drops the line it opened").
    await page.keyboard.type("o");
    await expect.poll(() => statusText(page)).toContain(REFUSED);
    await page.keyboard.press("Escape");
    expect(await page.locator("#n-two").innerText()).toBe(JOINED);
  });
});
