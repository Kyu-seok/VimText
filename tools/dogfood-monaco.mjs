// The Monaco Field's dogfooding steps (docs/release.md, "Monaco code editors")
// on the live sites, through the built extension in Playwright's Chromium with
// a fresh profile, signed out. It never signs in and never presses a site's Run
// or Submit. Run `npm run build` first, then
//   npm run dogfood:monaco -- <leetcode|code-bite|neetcode> [--off] [--out <dir>]
// With the setting on (the default) it walks the steps below on the site's own
// starting code and, after each, compares the editor's whole text, read through
// `monaco.editor.getEditors()`, with what Vim gives for the text before it.
// `--off` leaves the setting off: no Status Line, `dd` typed as text. neetcode
// has no `window.monaco`, so on or off VimText stands down there and the text
// is read from the lines Monaco draws. `--out` keeps a video and a step log,
// named for the site. Exit code 1 on a mismatch, a missing or unexpected Status
// Line, or an error thrown from the extension.
import { chromium } from "@playwright/test";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SITES = {
  // Serves a Cloudflare challenge to headless Chromium: headed.
  leetcode: {
    url: "https://leetcode.com/problems/stone-removal-game",
    headless: false,
    async pickLanguage(page) {
      // The description has a "C++" button too, before the editor's in the page.
      await page.locator("button", { hasText: "C++" }).last().click();
      await page.getByText("Java", { exact: true }).last().click();
    },
    async reset(page) {
      await page.locator("button:has(svg.fa-arrow-rotate-left)").first().click();
      await page.getByRole("button", { name: "Confirm" }).click({ timeout: 5000 });
    },
  },
  // Monaco's EditContext input. The page is in Korean: 언어 is "language", 코드 초기화 "reset the code".
  "code-bite": {
    url: "https://code-bite.com/problems/reverse-linked-list",
    headless: false,
    async pickLanguage(page) {
      await page.locator('[role=combobox][aria-label="언어"]').click();
      await page.getByRole("option", { name: "Java", exact: true }).click();
    },
    async reset(page) {
      await page.locator('button[aria-label="코드 초기화"]').click();
      // The site asks first: 취소 (cancel), 코드 초기화 (reset the code), 닫기 (close).
      await page
        .locator("[role=dialog] button, [role=alertdialog] button")
        .filter({ hasText: "코드 초기화" })
        .click({ timeout: 5000 });
    },
  },
  // No `window.monaco`: stood down. Headed, the page load was aborted in 2026-11.
  neetcode: {
    url: "https://neetcode.io/problems/climbing-stairs/question",
    headless: true,
    standsDown: true,
  },
};

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--out");
const settingOn = !args.includes("--off");
const outDir = args.includes("--out") ? resolve(args[args.indexOf("--out") + 1]) : null;
const site = SITES[name];
if (!site) {
  console.error(`usage: npm run dogfood:monaco -- <${Object.keys(SITES).join("|")}> [--off] [--out <dir>]`);
  process.exit(2);
}
const run = `${name}${settingOn ? "" : "-off"}`;
const dist = resolve("dist");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const logLines = [];
function out(line) {
  console.log(line);
  logLines.push(line);
}
let failures = 0;
function fail(line) {
  failures++;
  out(`!! ${line}`);
}

const profile = mkdtempSync(join(tmpdir(), "vimtext-dogfood-monaco-"));
if (outDir) mkdirSync(outDir, { recursive: true });
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: site.headless,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  ...(outDir ? { recordVideo: { dir: outDir, size: { width: 1280, height: 800 } } } : {}),
});
const page = context.pages()[0] ?? (await context.newPage());
const errors = [];
// The site's own errors are not ours: only one thrown from the extension's scripts counts.
page.on("pageerror", (e) => /chrome-extension:\/\//.test(e.stack ?? "") && errors.push(e.stack ?? e.message));
page.on("console", (m) => m.type() === "error" && /VimText/i.test(m.text()) && errors.push(m.text()));

/** The main code editor: the largest one Monaco lists (leetcode has a second, of one line and no size). */
const MAIN = `(() => {
  const area = (e) => { const r = e.getDomNode().getBoundingClientRect(); return r.width * r.height; };
  return window.monaco.editor.getEditors().reduce((a, b) => (area(b) > area(a) ? b : a));
})()`;
const viaMonaco = !site.standsDown;
/** The editor's whole text; on a site without `window.monaco`, the lines Monaco draws, which is all of a short file. */
const text = () =>
  viaMonaco
    ? page.evaluate(`${MAIN}.getValue()`)
    : page.evaluate(() =>
        [...document.querySelectorAll(".monaco-editor .view-lines > .view-line")]
          .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
          .map((l) => l.textContent.replace(/ /g, " "))
          .join("\n"),
      );
const language = () => page.evaluate(`${MAIN}.getModel().getLanguageId()`);
const cursorStyle = () =>
  page.evaluate(
    `window.monaco.editor.TextEditorCursorStyle[${MAIN}.getOption(window.monaco.editor.EditorOption.cursorStyle)]`,
  );
/** The Status Line that shows, "" when none does. */
const status = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("vimtext-status")]
      .filter((host) => !host.hidden)
      .map((host) => host.shadowRoot?.querySelector(".bar")?.textContent ?? "")
      .join("|"),
  );
const popupOpen = () =>
  page.evaluate(() => !!document.querySelector(".monaco-editor .suggest-widget.visible"));
const focusEditor = async () => {
  await page
    .locator(".monaco-editor .view-lines")
    .first()
    .click({ position: { x: 200, y: 8 } });
  await sleep(300);
};
/** Keys one at a time, as a person presses them; a name of several characters is a key, anything else a character. */
async function press(keys, delay = 60) {
  for (const k of keys) {
    await page.keyboard.press(k);
    await sleep(delay);
  }
  await sleep(500);
}
const chars = (s) => [...s].map((c) => (c === " " ? "Space" : c));
const lines = (t) => t.split("\n");
const show = (t) => JSON.stringify(t);

/** Presses `keys`, then compares the whole text with `expected`; returns the text the editor holds. */
async function step(label, keys, expected, delay) {
  await press(keys, delay);
  const actual = await text();
  const line = `${label.padEnd(46)} [${await status()}]`;
  if (actual === expected) out(`ok ${line}`);
  else fail(`${line}\n   expected ${show(expected)}\n   actual   ${show(actual)}`);
  return actual;
}

/** The Q17 commands (#113) on the text the editor holds, each followed by the `u` that takes it back. */
async function commands(base) {
  const l = lines(base);
  const undo = () => step("u", ["u"], base);

  const dd = l.slice(1).join("\n");
  await step("gg dd", ["g", "g", "d", "d"], dd);
  await undo();
  await step("Ctrl-r", ["Control+r"], dd);
  await undo();

  await step("gg yy p", ["g", "g", "y", "y", "p"], [l[0], ...l].join("\n"));
  await undo();

  // cw from the first non-blank: the run of word characters there, or of punctuation.
  const indent = l[0].match(/^\s*/)[0];
  const word = l[0].slice(indent.length).match(/^(\w+|[^\w\s]+)/)?.[0] ?? "";
  await step(
    "gg ^ cw NAME <Esc>",
    ["g", "g", "^", "c", "w", ...chars("NAME"), "Escape"],
    [indent + "NAME" + l[0].slice(indent.length + word.length), ...l.slice(1)].join("\n"),
  );
  await undo();

  await step("gg 0 x", ["g", "g", "0", "x"], base.slice(1));
  await step(". (the x again)", ["."], base.slice(2));
  await step("u", ["u"], base.slice(1));
  await undo();

  await step("gg 0 v l l d (Visual)", ["g", "g", "0", "v", "l", "l", "d"], base.slice(3));
  await undo();
  await step("gg V j d (Visual Line)", ["g", "g", "V", "j", "d"], l.slice(2).join("\n"));
  await undo();

  await step(":%s/e/E/g", [...chars(":%s/e/E/g"), "Enter"], base.replace(/e/g, "E"));
  await undo();
  // The engine's notice stays on the Status Line for some seconds: wait it out, so the steps after show the Mode.
  const noticed = Date.now();
  while (!(await status()).includes("--NORMAL--") && Date.now() - noticed < 15_000) await sleep(250);
  out(
    `   the :s notice left the Status Line after ${((Date.now() - noticed) / 1000).toFixed(1)} s more   [${await status()}]`,
  );

  // Insert: Monaco types. `zq` is no word of the file, so no suggestion takes the `(`.
  await sleep(1000);
  const typed = await step(
    "gg A ' zq(' <Esc> (Monaco closes the bracket)",
    ["g", "g", "A", ...chars(" zq("), "Escape"],
    [l[0] + " zq()", ...l.slice(1)].join("\n"),
    120,
  );
  if (typed === [l[0] + " zq(", ...l.slice(1)].join("\n"))
    out("   the site did not close the bracket: Monaco's own choice (DESIGN.md, accepted limitations)");
  await undo();

  // A suggestion popup, where typing opens one: the start of a word the file already holds.
  const prefix = (base.match(/[A-Za-z_]{5,}/) ?? ["class"])[0].slice(0, 3);
  await press(["g", "g", "A", "Space", ...chars(prefix)], 200);
  await sleep(1500);
  const opened = await popupOpen();
  out(
    `   typed ' ${prefix}' in Insert: suggestion popup ${opened ? "open" : "did not open"}   [${await status()}]`,
  );
  await step("<Esc> over the suggestion popup", ["Escape"], [l[0] + " " + prefix, ...l.slice(1)].join("\n"));
  if (await popupOpen()) fail("the suggestion popup is still open after one Esc");
  if ((await cursorStyle()) !== "Block")
    fail(`one Esc did not reach Normal: cursor style ${await cursorStyle()}`);
  await undo();
}

try {
  // The setting, through the extension's own storage, from its options page.
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/options/options.html`);
  await page.evaluate(
    (monaco) =>
      chrome.storage.sync.set({ settings: { enabled: true, sites: {}, vimrc: "", plugins: {}, monaco } }),
    settingOn,
  );
  out(
    `=== ${run}: ${site.url}, the Monaco Field's setting ${settingOn ? "on" : "off"}, ${new Date().toISOString()}`,
  );

  await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector(".monaco-editor .view-lines", { timeout: 60_000 });
  await page.waitForSelector('html[data-vimtext="ready"]', { state: "attached", timeout: 30_000 });
  await sleep(5000);
  const hasMonaco = await page.evaluate(() => typeof window.monaco?.editor?.getEditors === "function");
  out(
    `title ${show(await page.title())}; window.monaco ${hasMonaco ? "present" : "absent"}; focus goes to ${await (async () => {
      await focusEditor();
      return page.evaluate(
        () => `${document.activeElement.tagName.toLowerCase()}.${document.activeElement.className}`,
      );
    })()}`,
  );
  if (hasMonaco === !!site.standsDown)
    fail(
      `window.monaco is ${hasMonaco ? "present" : "absent"}: this site's entry in the tool is out of date`,
    );

  const base = await text();
  out(`starting text ${show(base)}`);

  if (!settingOn || site.standsDown) {
    // As 0.4.3: no Session, so no Status Line, and the keys are the page's.
    await press(["Escape", "d", "d"]);
    const after = await text();
    const hosts = await page.evaluate(() => document.querySelectorAll("vimtext-status").length);
    out(`<Esc> d d: Status Line [${await status()}], ${hosts} Status Line host(s), text ${show(after)}`);
    if (hosts || (await status())) fail("a Status Line where VimText stands down");
    if (after.length !== base.length + 2 || !after.includes("dd")) fail("`dd` was not typed as text");
  } else {
    const before = await cursorStyle();
    await step("<Esc>: Normal", ["Escape"], base);
    out(`   cursor style ${before} -> ${await cursorStyle()}; language ${await language()}`);
    if (!(await status()).includes("NORMAL")) fail(`no --NORMAL-- after Esc: [${await status()}]`);
    if ((await cursorStyle()) !== "Block") fail("no block cursor in Normal");
    await commands(base);

    // The language switch: the new code is the Field's text, and `u` does not reach back into the old language.
    await site.pickLanguage(page);
    await sleep(2500);
    const switched = await text();
    out(`language switched to ${await language()}: text ${show(switched)}`);
    if (switched === base) fail("the language switch left the text as it was");
    await focusEditor();
    out(`   back in the editor: [${await status()}], cursor style ${await cursorStyle()}`);
    await press(["Escape"]);
    await step("after the switch: gg dd", ["g", "g", "d", "d"], lines(switched).slice(1).join("\n"));
    await step("u", ["u"], switched);
    await step("u again (nothing of the old language)", ["u"], switched);

    // The reset button, after a change.
    await step("gg 0 x", ["g", "g", "0", "x"], switched.slice(1));
    await site.reset(page);
    await sleep(2500);
    const reset = await text();
    if (reset === switched) out("ok the reset button put the starting code back");
    else fail(`after the reset button\n   expected ${show(switched)}\n   actual   ${show(reset)}`);
    await focusEditor();
    out(`   back in the editor: [${await status()}], cursor style ${await cursorStyle()}`);
    await press(["Escape"]);
    await step("after the reset: gg dd", ["g", "g", "d", "d"], lines(reset).slice(1).join("\n"));
    await step("u", ["u"], reset);

    // Tab in Normal is a Pass-through (DESIGN.md "Key Policy"): recorded, not judged.
    await press(["g", "g", "Tab"]);
    const tabbed = await text();
    out(
      `Tab in Normal: [${await status()}], focus ${await page.evaluate(() => (document.activeElement?.closest(".monaco-editor") ? "in the editor" : "left the editor"))}, text ${tabbed === reset ? "unchanged" : show(tabbed)}`,
    );
    if (tabbed !== reset) {
      await press(["u"]);
      out(
        `   then u: text ${(await text()) === reset ? "as before the Tab" : show(await text())}   [${await status()}]`,
      );
    }
  }
  await sleep(1000);
} catch (e) {
  fail(`${run}: ${String(e.message).split("\n")[0]}`);
  out(`   title ${show(await page.title().catch(() => "?"))}`);
}
out(`VimText errors: ${errors.length ? errors.join(" | ") : "none"}`);
if (errors.length) failures++;
const passed = settingOn && !site.standsDown ? "every step as Vim gives it" : "stood down, as 0.4.3";
out(failures ? `${run}: ${failures} finding(s)` : `${run}: ${passed}`);

const video = outDir ? page.video() : null;
await context.close();
if (video) renameSync(await video.path(), join(outDir, `${run}.webm`));
if (outDir) writeFileSync(join(outDir, `${run}-steps.log`), logLines.join("\n") + "\n");
rmSync(profile, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
