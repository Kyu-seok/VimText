import { test, expect, ready, activateAtStart } from "./extension";

// The comment form's Field is full width with lines longer than the height
// oracle's ~30-character wrap guess: the one fixture where an unmeasured
// mirror moves a vertical motion to the wrong line (#38, docs/engine-seams.md
// "Layout"). `textarea.html`'s short lines never show it.

test("the first j after Activation on long unwrapped lines lets dd delete the second line", async ({
  page,
}) => {
  await page.goto("/comment-form.html");
  await ready(page);
  await activateAtStart(page, "#comment");
  const ta = page.locator("#comment");
  const lines = (await ta.inputValue()).split("\n");
  await page.keyboard.type("jdd");
  await expect(ta).toHaveValue([lines[0], ...lines.slice(2)].join("\n"));
});
