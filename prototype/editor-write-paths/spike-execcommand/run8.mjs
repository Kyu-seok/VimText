import { chromium } from '/Users/kyu/Work/VimText/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs';
const html = fs.readFileSync(new URL('./page.html', import.meta.url));
const srv = http.createServer((q, r) => { r.setHeader('content-type','text/html'); r.end(html); }).listen(8772);
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.log('pageerror', String(e).slice(0,200)));
await page.goto('http://localhost:8772/'); await page.waitForFunction(() => window.READY);
console.log(JSON.stringify(await page.evaluate(async () => {
  const sleep = ms => new Promise(r=>setTimeout(r,ms));
  const E = await EDITORS.lexical(['hello world','second line']);
  const before = E.root.innerHTML;
  const t1 = E.root.children[0].querySelector('span').firstChild, t2 = E.root.children[1].querySelector('span').firstChild;
  document.getSelection().setBaseAndExtent(t1, 8, t2, 3); document.dispatchEvent(new Event('selectionchange'));
  window.OK=document.execCommand('insertText', false, ''); document.dispatchEvent(new Event('selectionchange'));

  await sleep(300);
  return {ok: window.OK, before, after: E.root.innerHTML, model: E.model()};
})));
await browser.close(); srv.close();
