import { test, expect, statusText } from "./extension";

test.beforeEach(async ({ page }) => {
  await page.goto("/textarea.html");
  await page.waitForTimeout(150); // content script runs at document_idle
});

test("is inert until Esc, then shows NORMAL", async ({ page }) => {
  const ta = page.locator("#ta");
  await ta.focus();
  await page.keyboard.type("x");
  await expect(ta).toHaveValue(/^xthe quick/);
  expect(await statusText(page)).toBe("");
  await page.keyboard.press("Escape");
  expect(await statusText(page)).toContain("NORMAL");
  // the page did not see that first Esc
  await expect(page.locator("#log")).not.toContainText("page-esc");
});

test("motions, operators, undo, dot-repeat", async ({ page }) => {
  const ta = page.locator("#ta");
  await ta.focus();
  await ta.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
  await page.keyboard.press("Escape");
  await page.keyboard.type("dw");
  await expect(ta).toHaveValue(/^quick brown fox\n/);
  await page.keyboard.type(".");
  await expect(ta).toHaveValue(/^brown fox\n/);
  await page.keyboard.type("u");
  await expect(ta).toHaveValue(/^quick brown fox\n/);
  await page.keyboard.type("jdd");
  await expect(ta).toHaveValue("quick brown fox\nthird line here");
  await page.keyboard.type("ggA!");
  await page.keyboard.press("Escape");
  await expect(ta).toHaveValue("quick brown fox!\nthird line here");
  expect(await statusText(page)).toContain("NORMAL");
});

test("insert typing is native and becomes one undo step and repeatable", async ({ page }) => {
  const ta = page.locator("#ta");
  await ta.focus();
  await ta.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
  await page.keyboard.press("Escape");
  await page.keyboard.type("cwslow");
  await expect(ta).toHaveValue(/^slow quick/);
  expect(await statusText(page)).toContain("INSERT");
  await page.keyboard.press("Escape");
  await page.keyboard.type("w.");
  await expect(ta).toHaveValue(/^slow slow brown/);
  await page.keyboard.type("u");
  await expect(ta).toHaveValue(/^slow quick brown/);
  await page.keyboard.type("u");
  await expect(ta).toHaveValue(/^the quick brown/);
});

test("text objects, visual mode, ex :s", async ({ page }) => {
  const ta = page.locator("#ta");
  await ta.focus();
  await ta.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(6, 6));
  await page.keyboard.press("Escape");
  await page.keyboard.type("ciwfast");
  await page.keyboard.press("Escape");
  await expect(ta).toHaveValue(/^the fast brown/);
  await page.keyboard.type("0vee");
  expect(await statusText(page)).toContain("VISUAL");
  const sel = await ta.evaluate((el: HTMLTextAreaElement) =>
    el.value.slice(el.selectionStart, el.selectionEnd),
  );
  expect(sel).toBe("the fast");
  await page.keyboard.type("d");
  await expect(ta).toHaveValue(/^ brown fox/);
  await page.keyboard.type(":%s/o/0/g");
  await page.keyboard.press("Enter");
  await expect(ta).toHaveValue(" br0wn f0x\njumps 0ver the lazy d0g\nthird line here");
  expect(await statusText(page)).toContain("Found 4 matches"); // engine's notification, auto-closes
  await page.keyboard.type("x"); // cursor rests on the last substitution
  await expect(ta).toHaveValue(" br0wn f0x\njumps 0ver the lazy dg\nthird line here");
});

test("synthetic input events carry the inputType and data Chrome would", async ({ page }) => {
  const ta = page.locator("#ta");
  const log = page.locator("#log");
  await ta.focus();
  await ta.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
  await page.keyboard.press("Escape");
  await page.keyboard.type("x");
  await expect(ta).toHaveValue(/^he quick/);
  await expect(log).toHaveText("input:deleteContentBackward:null\n");
  await page.keyboard.type("yiwP");
  await expect(ta).toHaveValue(/^hehe quick/);
  await expect(log).toHaveText("input:deleteContentBackward:null\ninput:insertText:he\n");
});

test("second Esc in Normal reaches the page; Tab passes through", async ({ page }) => {
  const ta = page.locator("#ta");
  await ta.focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.locator("#log")).toContainText("page-esc");
  await page.keyboard.press("Tab");
  await expect(page.locator("#in")).toBeFocused();
});

test(":q leaves the field; refocus resumes Normal", async ({ page }) => {
  const ta = page.locator("#ta");
  await ta.focus();
  await page.keyboard.press("Escape");
  await page.keyboard.type(":q");
  await page.keyboard.press("Enter");
  await expect(ta).not.toBeFocused();
  expect(await statusText(page)).toBe("");
  await ta.focus();
  expect(await statusText(page)).toContain("NORMAL");
  await page.keyboard.type("x");
  await expect(ta).toHaveValue(/^he quick/);
});

for (const cmd of [":wq", ":x"]) {
  test(`${cmd} says the page owns saving, then leaves the field`, async ({ page }) => {
    const ta = page.locator("#ta");
    await ta.focus();
    await page.keyboard.press("Escape");
    await page.keyboard.type(cmd);
    await page.keyboard.press("Enter");
    await expect(ta).not.toBeFocused();
    expect(await statusText(page)).toContain("nothing to write");
    await expect.poll(() => statusText(page), { timeout: 5000 }).toBe(""); // notice closes, bar hides
  });
}
