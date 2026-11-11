import { chromium } from '/Users/kyu/Work/VimText/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs';
const html = fs.readFileSync(new URL('./page.html', import.meta.url));
const srv = http.createServer((q, r) => { r.setHeader('content-type','text/html'); r.end(html); }).listen(8765);
const browser = await chromium.launch();
const cases = [
  ['insertText collapsed', [0,5,0,5], 'insertText', 'XY'],
  ['insertText replace in node', [0,0,0,5], 'insertText', 'HEY'],
  ['delete within block', [0,1,0,4], 'delete'],
  ['delete across blocks', [0,8,1,3], 'delete'],
  ['dd-style: end of line 0 to end of line 1', [0,11,1,11], 'delete'],
  ['insertParagraph mid-block', [0,5,0,5], 'insertParagraph'],
  ['insertParagraph+insertText (o)', [0,11,0,11], 'insertParagraph', null, 'new'],
];
for (const name of ['lexical','quill','slate']) {
  for (const [label, sel, cmd, val, then] of cases) {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log('   pageerror', String(e).slice(0,150)));
    await page.goto('http://localhost:8765/');
    await page.waitForFunction(() => window.READY, null, {timeout: 30000});
    const out = await page.evaluate(async ({name, sel, cmd, val, then}) => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const E = await window.EDITORS[name](['hello world', 'second line']);
      await sleep(200);
      const blocks = () => Array.from(E.root.children);
      const textAt = (bi, off) => { const w = document.createTreeWalker(blocks()[bi], NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (off <= n.data.length) return [n, off]; off -= n.data.length; } return [blocks()[bi], 0]; };
      const [a, ao] = textAt(sel[0], sel[1]); const [f, fo] = textAt(sel[2], sel[3]);
      const evs = []; for (const t of ['beforeinput','input']) E.root.addEventListener(t, e => evs.push(t+':'+e.inputType), true);
      document.getSelection().setBaseAndExtent(a, ao, f, fo);
      document.dispatchEvent(new Event('selectionchange'));
      const ok = document.execCommand(cmd, false, val ?? undefined);
      document.dispatchEvent(new Event('selectionchange'));
      if (then) { document.execCommand('insertText', false, then); document.dispatchEvent(new Event('selectionchange')); }
      const domNow = blocks().map(b => b.textContent);
      await sleep(400);
      const r = {ok, evs: evs.join(','), domNow, domLater: blocks().map(b => b.textContent), model: E.model()};
      // provoke a re-render: type via a model-independent native selection move
      E.undo(); await sleep(400);
      r.afterUndoDom = blocks().map(b => b.textContent); r.afterUndoModel = E.model();
      r.lexErr = window.LEXERR;
      return r;
    }, {name, sel, cmd, val, then});
    console.log(name.padEnd(8), label.padEnd(42), JSON.stringify(out));
    await page.close();
  }
}
await browser.close(); srv.close();
