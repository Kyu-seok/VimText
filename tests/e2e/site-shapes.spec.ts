import { test, expect, statusText, ready, activateAtStart, submitForNotice, focusedId } from "./extension";
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

  test("burst: A, Enter, text and Esc back to back keep the text on the line below (#68, #70)", async ({
    page,
  }) => {
    await burst(page, ["G", "A", "Enter", "f", "a", "s", "t", "Escape"]);
    // Mostly the Enter is written, its break taken as Shift+Enter (#70); under
    // load it is sometimes the person's own key, splitting the block. Both
    // render the same lines.
    const page_ = ["Add icon Add cover", "Scratch", "alpha beta gamma", "line one", "line two"];
    await expect.poll(() => lines(page, "#notion")).toEqual([...page_, "line three", "fast"]);
    await notRefused(page);
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

  /**
   * The command line closing gives the block focus back (#97): the root
   * focused, the caret inside the block, the Cursor on the character it was
   * on, so the next key is the block's. The engine's re-focus used to focus
   * the root alone, which left the caret at the root's start, outside every
   * block: the next key reached no Session and the page took it as text.
   *
   * Coverage (CODING_STANDARDS rule 5): Normal mode for each closing, Visual
   * mode, and Insert and Replace mode through `Ctrl-o`, on a block of the
   * root in the document. The other Field kinds: `command-line.spec.ts`. A
   * nested Field inside an open shadow root is not covered here.
   */
  /** The root's text before block `#n-two`: the header's controls, the title and block `#n-one`. */
  const BEFORE_BLOCK = "Add icon Add coverScratchalpha beta gamma";
  /** The root's whole text with `firstLine` as the first line of block `#n-two`, the rest as the fixture has it. */
  const rootWith = (firstLine: string) => `${BEFORE_BLOCK}${firstLine}\nline two\nline three`;
  /** Whether the block has focus as a nested Field does: the root focused, the caret inside the block. */
  const blockFocused = (page: Page) =>
    page.locator("#n-two").evaluate((block) => {
      const doc = block.ownerDocument;
      return doc.activeElement?.id === "notion" && block.contains(doc.getSelection()!.anchorNode);
    });
  const rootText = (page: Page) => page.locator("#notion").evaluate((root) => root.textContent);

  for (const closing of [
    { name: "Esc in the : command line", keys: [":", "Escape"] },
    { name: "Esc in the / command line", keys: ["/", "Escape"] },
    { name: "Esc in the ? command line", keys: ["?", "Escape"] },
    { name: "Enter on :noh", keys: [":", "n", "o", "h", "Enter"] },
  ]) {
    test(`${closing.name} leaves the block focused, the Cursor where it was (#97)`, async ({ page }) => {
      await page.keyboard.press("w");
      const prompt = closing.keys[0]!;
      await page.keyboard.press(prompt);
      await expect.poll(() => statusText(page)).toContain(prompt);
      for (const key of closing.keys.slice(1)) await page.keyboard.press(key);
      await expect.poll(() => blockFocused(page)).toBe(true);
      // `x` deletes the character `w` moved to, the second word's first, and nothing outside the block.
      await page.keyboard.press("x");
      await expect.poll(() => rootText(page)).toBe(rootWith("line ne"));
    });
  }

  test("Enter on an unknown ex command shows its notice and leaves the block focused, the Cursor where it was (#97)", async ({
    page,
  }) => {
    await page.keyboard.press("w");
    await submitForNotice(page, ":bogus", "Not an editor command");
    await expect.poll(() => blockFocused(page)).toBe(true);
    await page.keyboard.press("x");
    await expect.poll(() => rootText(page)).toBe(rootWith("line ne"));
  });

  test("Esc in the : command line opened from Visual mode leaves the selection the block held (#97)", async ({
    page,
  }) => {
    for (const key of ["w", "v", "e", ":"]) await page.keyboard.press(key);
    await expect.poll(() => statusText(page)).toContain(":");
    await page.keyboard.press("Escape");
    await expect.poll(() => blockFocused(page)).toBe(true);
    // `x` deletes the second word, which `ve` selected.
    await page.keyboard.press("x");
    await expect.poll(() => rootText(page)).toBe(rootWith("line "));
  });

  for (const mode of [
    { name: "Insert", key: "i", status: "INSERT" },
    { name: "Replace", key: "R", status: "REPLACE" },
  ]) {
    test(`Enter on an unknown ex command after Ctrl-o in ${mode.name} mode leaves the block focused (#97)`, async ({
      page,
    }) => {
      await page.keyboard.press("w");
      await page.keyboard.press(mode.key);
      await expect.poll(() => statusText(page)).toContain(mode.status);
      await page.keyboard.press("Control+o");
      await submitForNotice(page, ":bogus", "Not an editor command");
      await expect.poll(() => blockFocused(page)).toBe(true);
      // The engine comes back in Insert mode from both (`command-line.spec.ts`): the character goes in at the Cursor.
      await page.keyboard.type("Z");
      await expect.poll(() => rootText(page)).toBe(rootWith("line Zone"));
    });
  }

  /**
   * A click outside the command line while it is open closes it and stands
   * (#97, #100): the caret stays where the click put it, the root's text is
   * unchanged, and the Status Line of the block the caret left hides, with no
   * prompt character left in it.
   *
   * Coverage (CODING_STANDARDS rule 5): Normal mode on a block of the root in
   * the document, for `:` and `/`: a click into another block, on the
   * header's controls (in the root, outside every block) and on page text
   * outside the root, then back into the block by a click and by the caret
   * moving into it. The other Field kinds: `command-line.spec.ts`.
   */

  /** Where the caret is: a block's id, "controls", or null outside the root's parts. */
  const caretIn = (page: Page) =>
    page.evaluate(() => {
      const part = document.getSelection()!.anchorNode?.parentElement?.closest(".block, .controls");
      return part ? part.id || part.className : null;
    });

  for (const prompt of [":", "/"]) {
    for (const click of [
      { on: "into another block", target: "#n-one", focus: "notion", caret: "n-one" },
      { on: "on the header's controls", target: "#notion .controls", focus: "notion", caret: "controls" },
      { on: "on text outside the root", target: "h1", focus: "", caret: null },
    ]) {
      test(`a click ${click.on} with the ${prompt} command line open leaves the caret where the click put it and hides the Status Line (#97, #100)`, async ({
        page,
      }) => {
        await page.keyboard.press("w");
        await page.keyboard.press(prompt);
        await expect.poll(() => statusText(page)).toContain(prompt);
        await page.locator(click.target).click();
        // The command line closes a task after its input blurs.
        await expect.poll(() => statusText(page)).toBe("");
        expect(await focusedId(page)).toBe(click.focus);
        if (click.caret) expect(await caretIn(page)).toBe(click.caret);
        // A key that moves the caret natively, within the clicked part (the click lands past its text's end): not the block's key, whose bar stays hidden.
        await page.keyboard.press("ArrowLeft");
        expect(await statusText(page)).toBe("");
        expect(await focusedId(page)).toBe(click.focus);
        if (click.caret) expect(await caretIn(page)).toBe(click.caret);
        expect(await rootText(page)).toBe(rootWith("line one"));
      });
    }

    test(`a click back into the block with the ${prompt} command line open leaves it in Normal mode at the clicked place (#100)`, async ({
      page,
    }) => {
      await page.keyboard.press("w");
      await page.keyboard.press(prompt);
      await expect.poll(() => statusText(page)).toContain(prompt);
      // The start of the block's first line, where `w` no longer has the Cursor.
      await page.locator("#n-two").click({ position: { x: 3, y: 8 } });
      await expect.poll(() => statusText(page)).toBe("--NORMAL--");
      await page.keyboard.press("x");
      await expect.poll(() => rootText(page)).toBe(rootWith("ine one"));
    });
  }

  test("a click back into the block after a click into another with the command line open shows its Mode again (#100)", async ({
    page,
  }) => {
    await page.keyboard.press("w");
    await page.keyboard.press(":");
    await expect.poll(() => statusText(page)).toContain(":");
    await page.locator("#n-one").click();
    await expect.poll(() => statusText(page)).toBe("");
    await page.locator("#n-two").click({ position: { x: 3, y: 8 } });
    await expect.poll(() => statusText(page)).toBe("--NORMAL--");
    await page.keyboard.press("x");
    await expect.poll(() => rootText(page)).toBe(rootWith("ine one"));
  });

  test("the caret moving back into the block after a click into another with the command line open shows its Mode again (#100)", async ({
    page,
  }) => {
    await page.keyboard.press("w");
    await page.keyboard.press(":");
    await expect.poll(() => statusText(page)).toContain(":");
    // The click lands past the end of the block's text: one step right is the next block's start.
    await page.locator("#n-one").click();
    await expect.poll(() => statusText(page)).toBe("");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => statusText(page)).toBe("--NORMAL--");
    await page.keyboard.press("x");
    await expect.poll(() => rootText(page)).toBe(rootWith("ine one"));
  });

  /**
   * The command line keeps focus when the page writes a selection back into
   * the block just after it opened (#98). Notion writes the Cursor VimText
   * announced back to the DOM some milliseconds later, and a selection set
   * inside a blurred editable root focuses it: a move and `:` typed back to
   * back left the prompt showing with focus on the root, and the keys typed
   * next were the block's Normal keys.
   *
   * Coverage (CODING_STANDARDS rule 5): on a block of the root in the
   * document, Normal mode after `w` and `b` for `:`, and `/` and `?` after
   * `w`; Visual mode for `:`. Insert and Replace mode write no Cursor back
   * before `Ctrl-o :` (the caret is the page's own), and are not covered. The
   * other Field kinds have no page that writes a selection back; a click back
   * into each with the command line open, which the Session now reads when
   * the prompt closes: `command-line.spec.ts` and `shadow-contenteditable.spec.ts`.
   */

  /**
   * Types `keys` back to back, the last of them opening the command line, and
   * waits for the page to write its selection back over it: the keys a test
   * types next come after the write, the order #98 was seen in. The page's
   * delay is widened first (live: 18 ms), so the write lands after the
   * command line opened on a loaded machine too.
   */
  async function openOverWrite(page: Page, keys: string): Promise<void> {
    await page.locator("#notion").evaluate((root: HTMLElement) => (root.dataset.writeDelay = "250"));
    await page.keyboard.type(keys);
    await expect.poll(() => page.locator("#notion").getAttribute("data-writes")).toBe("1");
  }

  for (const move of ["w", "b"]) {
    test(`${move} and : typed back to back, then noh and Enter after the page's write: the prompt takes the keys and the block has focus again (#98)`, async ({
      page,
    }) => {
      // `b` from the third word, so both moves end on the second word's first character.
      if (move === "b") await page.keyboard.type("ww");
      await openOverWrite(page, `${move}:`);
      // As Normal keys, `o` would open a line and `h` be typed into it.
      await page.keyboard.type("noh");
      await page.keyboard.press("Enter");
      await expect.poll(() => statusText(page)).toBe("--NORMAL--");
      await expect.poll(() => blockFocused(page)).toBe(true);
      expect(await rootText(page)).toBe(rootWith("line one"));
      // `x` deletes the character the move ended on.
      await page.keyboard.press("x");
      await expect.poll(() => rootText(page)).toBe(rootWith("line ne"));
    });
  }

  // The page's write lands before, among or after these keys, as the machine has it: each
  // order ends the same. After the write, deterministically: the test above, which is the
  // one red without the fix; this one passes there whenever the keys beat the write.
  test("w, : and noh typed with no pause, then Enter: the block has focus again, its text unchanged", async ({
    page,
  }) => {
    await page.keyboard.type("w:noh");
    await page.keyboard.press("Enter");
    await expect.poll(() => statusText(page)).toBe("--NORMAL--");
    await expect.poll(() => blockFocused(page)).toBe(true);
    expect(await rootText(page)).toBe(rootWith("line one"));
    await page.keyboard.press("x");
    await expect.poll(() => rootText(page)).toBe(rootWith("line ne"));
  });

  test("w and / typed back to back, then two and Enter: the search runs and the Cursor is on its match (#98)", async ({
    page,
  }) => {
    await openOverWrite(page, "w/");
    await page.keyboard.type("two");
    await page.keyboard.press("Enter");
    await expect.poll(() => blockFocused(page)).toBe(true);
    // `x` deletes the first character of the match, on the block's second line.
    await page.keyboard.press("x");
    await expect.poll(() => rootText(page)).toBe(`${BEFORE_BLOCK}line one\nline wo\nline three`);
  });

  test("the page's write landing while a search is being typed: the prompt keeps what was typed and takes the rest (#98)", async ({
    page,
  }) => {
    await openOverWrite(page, "w/tw");
    await page.keyboard.type("o");
    await page.keyboard.press("Enter");
    await expect.poll(() => blockFocused(page)).toBe(true);
    // The search for `two` ran: `x` deletes the first character of its match.
    await page.keyboard.press("x");
    await expect.poll(() => rootText(page)).toBe(`${BEFORE_BLOCK}line one\nline wo\nline three`);
  });

  for (const prompt of ["/", "?"]) {
    test(`w and ${prompt} typed back to back, then zz and Esc: nothing is typed into the block, which has focus again (#98)`, async ({
      page,
    }) => {
      await openOverWrite(page, `w${prompt}`);
      await page.keyboard.type("zz");
      await expect.poll(() => statusText(page)).toContain(prompt);
      await page.keyboard.press("Escape");
      await expect.poll(() => statusText(page)).toBe("--NORMAL--");
      await expect.poll(() => blockFocused(page)).toBe(true);
      expect(await rootText(page)).toBe(rootWith("line one"));
      await page.keyboard.press("x");
      await expect.poll(() => rootText(page)).toBe(rootWith("line ne"));
    });
  }

  test("w and : typed back to back, then an unknown ex command and Enter: its notice shows and the block has focus again (#98)", async ({
    page,
  }) => {
    await openOverWrite(page, "w:");
    await page.keyboard.type("bogus");
    await page.keyboard.press("Enter");
    await expect.poll(() => statusText(page)).toContain("Not an editor command");
    await expect.poll(() => blockFocused(page)).toBe(true);
    await page.keyboard.press("x");
    await expect.poll(() => rootText(page)).toBe(rootWith("line ne"));
  });

  test("w, v, e and : typed back to back: Esc leaves the selection the block held (#98)", async ({
    page,
  }) => {
    await openOverWrite(page, "wve:");
    await expect.poll(() => statusText(page)).toContain(":");
    await page.keyboard.press("Escape");
    await expect.poll(() => blockFocused(page)).toBe(true);
    // `x` deletes the second word, which `ve` selected.
    await page.keyboard.press("x");
    await expect.poll(() => rootText(page)).toBe(rootWith("line "));
  });

  // Notion takes a line break VimText writes inside a block only as a
  // Shift+Enter keydown, offered after the refused paragraph break (#70).
  test("u of J brings the line break back (#70)", async ({ page }) => {
    await page.keyboard.type("J");
    await expect.poll(() => lines(page, "#n-two")).toEqual(["line one line two", "line three"]);
    await page.keyboard.type("u");
    await expect.poll(() => lines(page, "#n-two")).toEqual(["line one", "line two", "line three"]);
    await notRefused(page);
  });

  test("o then text opens a line below in the block (#70)", async ({ page }) => {
    await page.keyboard.type("onew");
    await page.keyboard.press("Escape");
    await expect.poll(() => lines(page, "#n-two")).toEqual(["line one", "new", "line two", "line three"]);
    await notRefused(page);
    expect(await page.locator("#n-one").innerText()).toBe("alpha beta gamma");
  });

  test("O then text opens a line above in the block (#70)", async ({ page }) => {
    await page.keyboard.type("jOnew");
    await page.keyboard.press("Escape");
    await expect.poll(() => lines(page, "#n-two")).toEqual(["line one", "new", "line two", "line three"]);
    await notRefused(page);
  });

  test("a linewise p puts the line below in the block (#70)", async ({ page }) => {
    await page.keyboard.type("yyjp");
    await expect
      .poll(() => lines(page, "#n-two"))
      .toEqual(["line one", "line two", "line one", "line three"]);
    await notRefused(page);
  });
});
