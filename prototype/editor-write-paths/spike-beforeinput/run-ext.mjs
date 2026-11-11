import { chromium } from '/Users/kyu/Work/VimText/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const dir = new URL('./', import.meta.url);
const srv = http.createServer((q, r) => { const p = q.url.split('?')[0]; const f = p === '/' ? 'page.html' : p.slice(1);
  r.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html'); try { r.end(fs.readFileSync(new URL(f, dir))); } catch { r.statusCode = 404; r.end(); } }).listen(8782);
const ext = new URL('ext', dir).pathname;
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'vtx-')), {channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`]});
const A = [[['hello world']], [['second line']]];
const B = [[['hello '], ['world', true], [' end']], [['second line']]];
const CASES = {
  insX: {fx: A, ops: [{sel: [0,5,0,5], text: 'X'}]}, cw: {fx: A, ops: [{sel: [0,6,0,11], text: 'there'}]},
  delWhole: {fx: B, ops: [{sel: [0,6,0,11], text: ''}]}, delVis: {fx: A, ops: [{sel: [0,8,1,3], text: ''}]},
  insCross: {fx: A, ops: [{sel: [0,8,1,3], text: 'Z'}]}, o: {fx: A, ops: [{sel: [0,11,0,11], text: '\nnew'}]},
  rCR: {fx: A, ops: [{sel: [0,5,0,6], text: '\n'}]}, split: {fx: A, ops: [{sel: [0,5,0,5], text: 'A\nB'}]}, J: {fx: A, ops: [{sel: [0,11,1,0], text: ''}, {text: ' '}]},
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const ed of (process.env.ED || 'lexical,slate,quill,prosemirror,bare').split(',')) for (const [k, c] of Object.entries(CASES)) {
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  await page.goto('http://localhost:8782/'); await page.waitForFunction(() => window.READY);
  const csLoaded = await page.evaluate(() => document.documentElement.getAttribute('data-vt-cs'));
  await page.evaluate(([e, fx]) => mount(e, fx), [ed, c.fx]); await sleep(150);
  await page.evaluate(() => { window.SEEN = []; document.addEventListener('beforeinput', ev => { const rs = ev.getTargetRanges();
    SEEN.push({type: ev.inputType, data: ev.data, trusted: ev.isTrusted, isInputEvent: ev instanceof InputEvent, n: rs.length,
      static: rs[0] instanceof StaticRange, sc: rs[0] && (rs[0].startContainer.nodeType === 3 ? '#text:' + rs[0].startContainer.data : rs[0].startContainer.nodeName),
      inHost: rs[0] ? E.root.contains(rs[0].startContainer) : null, so: rs[0]?.startOffset, eo: rs[0]?.endOffset}); }, true); });
  const cfg = {mode: 'bi', deleteType: 'deleteContentBackward', timing: process.env.TIMING};
  const log = await page.evaluate(([cfg, ops]) => new Promise(res => { addEventListener('message', e => e.data?.vtDone && res(e.data.vtDone)); postMessage({vtWrite: {cfg, ops}}, '*'); }), [cfg, c.ops]);
  await sleep(400);
  const st = await page.evaluate(() => state()); const seen = await page.evaluate(() => SEEN);
  console.log(ed.padEnd(11), k.padEnd(9), 'cs:' + csLoaded, log.map(s => s.cmd + (s.prevented ? '[P]' : '[-]') + (s.exec === undefined ? '' : '+x')).join(' ').padEnd(40),
    JSON.stringify(st.model), JSON.stringify(st.dom) === JSON.stringify(st.model) ? '' : 'DOM ' + JSON.stringify(st.dom), '| page saw:', JSON.stringify(seen[0]), errs.length ? 'ERR ' + errs[0] : '');
  await page.close();
}
await ctx.close(); srv.close();
