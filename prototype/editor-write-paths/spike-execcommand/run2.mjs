import { chromium } from '/Users/kyu/Work/VimText/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs';
const html = fs.readFileSync(new URL('./page.html', import.meta.url));
const srv = http.createServer((q, r) => { r.setHeader('content-type','text/html'); r.end(html); }).listen(8766);
const browser = await chromium.launch();
async function go(name, fn, paras=['hello world','second line']) {
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('   pageerror', String(e).slice(0,200)));
  page.on('console', m => m.type()==='error' && console.log('   console', m.text().slice(0,200)));
  await page.goto('http://localhost:8766/'); await page.waitForFunction(() => window.READY);
  await page.evaluate(async ({name, paras}) => { window.E = await window.EDITORS[name](paras); await new Promise(r=>setTimeout(r,200));
    window.blocks = () => Array.from(E.root.children);
    window.textAt = (bi, off) => { const w = document.createTreeWalker(blocks()[bi], NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (off <= n.data.length) return [n, off]; off -= n.data.length; } return [blocks()[bi], 0]; };
    window.sel = (b1,o1,b2,o2) => { const [a,ao]=textAt(b1,o1), [f,fo]=textAt(b2,o2); document.getSelection().setBaseAndExtent(a,ao,f,fo); document.dispatchEvent(new Event('selectionchange')); };
    window.cmd = (c,v) => { const ok=document.execCommand(c,false,v); document.dispatchEvent(new Event('selectionchange')); return ok; };
    window.state = () => ({dom: blocks().map(b=>b.textContent), model: E.model()});
  }, {name, paras});
  const r = await fn(page); console.log(name.padEnd(8), JSON.stringify(r)); await page.close();
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));
// Slate: divergence then real typing in the same leaf
await go('slate', async p => { await p.evaluate(()=>{sel(0,5,0,5); cmd('insertText','XY');}); await sleep(300);
  await p.evaluate(()=>sel(0,13,0,13)); await sleep(300); await p.keyboard.type('Z'); await sleep(300);
  const a = await p.evaluate(()=>state()); await p.evaluate(()=>{sel(1,0,1,0)}); await sleep(300); await p.keyboard.type('Q'); await sleep(300);
  return {afterTypingSameLeaf: a, afterTypingOtherBlock: await p.evaluate(()=>state())}; });
// Lexical: insertText across blocks (visual c), and a delete spanning a bold run inside one block
await go('lexical', async p => { await p.evaluate(()=>{sel(0,8,1,3); cmd('insertText','Z');}); await sleep(300); return {insertTextAcrossBlocks: await p.evaluate(()=>state())}; });
await go('lexical', async p => { const r = await p.evaluate(async ()=>{ // make 'world' bold through the editor's own command
  sel(0,6,0,11); document.execCommand('bold'); await new Promise(r=>setTimeout(r,200)); const before = {html: E.root.innerHTML, ...state()};
  sel(0,3,0,8); cmd('delete'); await new Promise(r=>setTimeout(r,300)); return {before, after: {html: E.root.innerHTML, ...state()}}; }); return r; });
// Lexical: x (delete one char) with Normal-mode 1-char selection, then real typing
await go('lexical', async p => { await p.evaluate(()=>{sel(0,0,0,1); cmd('delete');}); await sleep(200); await p.evaluate(()=>sel(0,0,0,0)); await sleep(200); await p.keyboard.type('J'); await sleep(200); return p.evaluate(()=>state()); });
// Quill: dd-style on list? keep simple: insertParagraph inside a header line keeps format?
await go('quill', async p => p.evaluate(async ()=>{ const q = Quill.find(document.getElementById('quill')); q.formatLine(0,1,'header',1); await new Promise(r=>setTimeout(r,100)); sel(0,5,0,5); cmd('insertParagraph'); await new Promise(r=>setTimeout(r,300)); return {delta: q.getContents().ops, html: E.root.innerHTML}; }));
await browser.close(); srv.close();
