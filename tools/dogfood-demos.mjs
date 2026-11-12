// The M4 dogfooding steps (docs/release.md, "M4: contenteditable editors") on
// public live demos of the pinned editor libraries, through the built extension
// in Playwright's Chromium: the route when no one is at a signed-in browser.
// It covers the libraries, not the real sites; sign-ins and send keys stay with
// a person. Run `npm run build` first, then `npm run dogfood:demos [name]`.
//
// Each step prints the top of the editor's text. After an edit, a native Insert
// keystroke (a, Z, Backspace, Esc) shows whether the edit survived the editor's
// next render ("!! changed"); an edit the editor's model never took comes back
// there. Steps feeding a `u` skip it, so the keystroke never becomes the undo.
import { chromium } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const dist = resolve("dist");
const only = process.argv[2];

const DEMOS = [
  {
    name: "prosemirror",
    url: "https://prosemirror.net/examples/basic/",
    host: ".ProseMirror[contenteditable=true]",
  },
  { name: "lexical", url: "https://playground.lexical.dev/", host: "[data-lexical-editor=true]" },
  { name: "slate", url: "https://www.slatejs.org/examples/richtext", host: "[data-slate-editor=true]" },
  // The editor sits in a cross-origin sandbox frame.
  { name: "quill", url: "https://quilljs.com/playground/snow", host: ".ql-editor" },
];

/** [label, keys, check after with a real keystroke] */
const STEPS = [
  ["gg dd", ["g", "g", "d", "d"], false],
  ["u", ["u"], false],
  ["Ctrl-r", ["Control+r"], false],
  ["u", ["u"], true],
  ["gg o new<Esc>", ["g", "g", "o", "n", "e", "w", "Escape"], true],
  ["gg J", ["g", "g", "J"], false],
  ["u", ["u"], true],
  ["j dd", ["j", "d", "d"], true],
  [
    "gg j 0 w cw BOLD (inside the bold run)",
    ["g", "g", "j", "0", "w", "c", "w", "B", "O", "L", "D", "Escape"],
    true,
  ],
  ["0 x", ["0", "x"], true],
  ["gg 0 3x .", ["g", "g", "0", "3", "x", "."], true],
  ["G 0 r!", ["G", "0", "r", "!"], true],
  ["gg 0 w v e d", ["g", "g", "0", "w", "v", "e", "d"], true],
  ["gg yy p", ["g", "g", "y", "y", "p"], true],
  ["G A <Enter> x <Esc> (Insert Enter)", ["G", "A", "Enter", "x", "Escape"], true],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "vimtext-dogfood-")), {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
let failures = 0;
for (const demo of DEMOS.filter((d) => !only || d.name === only)) {
  const page = await context.newPage();
  const errors = [];
  // The demo sites' own errors are not ours: only one thrown from the extension counts.
  page.on("pageerror", (e) => /chrome-extension:\/\//.test(e.stack ?? "") && errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && /VimText/i.test(m.text()) && errors.push(m.text()));
  console.log(`\n=== ${demo.name} ${demo.url}`);
  try {
    await page.goto(demo.url, { waitUntil: "load", timeout: 45_000 });
    await sleep(2500);
    let frame = page.mainFrame();
    for (const f of page.frames())
      if (
        await f
          .locator(demo.host)
          .count()
          .catch(() => 0)
      )
        frame = f;
    const host = frame.locator(demo.host).first();
    await host.waitFor({ timeout: 20_000 });
    const kb = page.keyboard;
    const text = () =>
      host.evaluate((el) =>
        el.innerText
          .replace(/ /g, " ")
          .split("\n")
          .filter((l) => l.trim())
          .slice(0, 4)
          .map((l) => l.slice(0, 60))
          .join(" | "),
      );
    const status = () =>
      frame.evaluate(() => {
        const s = document.querySelector("vimtext-status");
        if (!s) return "";
        const root = s.shadowRoot ?? s;
        return [...root.querySelectorAll(".bar span, .bar input")]
          .map((e) => e.value ?? e.textContent)
          .join(" ")
          .trim();
      });
    const press = async (keys) => {
      for (const k of keys) {
        await kb.press(k);
        await sleep(40);
      }
      await sleep(300);
    };

    await host.click();
    await kb.press("ControlOrMeta+a");
    await kb.press("Backspace");
    await kb.type("alpha beta gamma");
    await kb.press("Enter");
    await kb.type("plain ");
    await kb.press("ControlOrMeta+b");
    await kb.type("bold word");
    await kb.press("ControlOrMeta+b");
    await kb.type(" tail");
    await kb.press("Enter");
    await kb.type("third line here");
    await press(["Escape"]);
    console.log(`typed      ${await text()}   [${await status()}]`);
    for (const [label, keys, check] of STEPS) {
      await press(keys);
      const after = await text();
      let note = "";
      if (check) {
        await press(["a"]);
        await kb.type("Z");
        await sleep(80);
        await kb.press("Backspace");
        await press(["Escape"]);
        const later = await text();
        if (later !== after) note = `\n  !! changed after a real keystroke: ${later}`;
      }
      console.log(`${label.padEnd(40)} ${after}   [${await status()}]${note}`);
    }
    await press([":", "q", "Enter"]);
    const focused = await host.evaluate((el) => el.contains(el.ownerDocument.activeElement));
    console.log(`:q         focus left the editor: ${!focused}; text ${await text()}`);
  } catch (e) {
    failures++;
    console.log(`!! ${demo.name}: ${e.message.split("\n")[0]}`);
  }
  console.log(`VimText errors: ${errors.length ? errors.join(" | ") : "none"}`);
  if (errors.length) failures++;
  await page.close();
}
await context.close();
process.exit(failures ? 1 : 0);
