import { chromium } from '/Users/kyu/Work/VimText/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs';
const dir = new URL('./', import.meta.url);
const srv = http.createServer((q, r) => { const p = q.url.split('?')[0]; const f = p === '/' ? 'page.html' : p.slice(1);
  r.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html'); try { r.end(fs.readFileSync(new URL(f, dir))); } catch { r.statusCode = 404; r.end(); } }).listen(8781);
const A = [[['hello world']], [['second line']]];
const B = [[['hello '], ['world', true], [' end']], [['second line']]];
export const CASES = {
  insX:      {fx: A, ops: [{sel: [0,5,0,5], text: 'X'}], exp: ['helloX world', 'second line']},
  insXY:     {fx: A, ops: [{sel: [0,5,0,5], text: 'XY'}], exp: ['helloXY world', 'second line']},
  r:         {fx: A, ops: [{sel: [0,0,0,1], text: 'J'}], exp: ['Jello world', 'second line']},
  cw:        {fx: A, ops: [{sel: [0,6,0,11], text: 'there'}], exp: ['hello there', 'second line']},
  delNode:   {fx: A, ops: [{sel: [0,2,0,5], text: ''}], exp: ['he world', 'second line']},
  delBold:   {fx: B, ops: [{sel: [0,3,0,8], text: ''}], exp: ['helrld end', 'second line']},
  delWhole:  {fx: B, ops: [{sel: [0,6,0,11], text: ''}], exp: ['hello  end', 'second line']},
  delBound:  {fx: A, ops: [{sel: [0,11,1,0], text: ''}], exp: ['hello worldsecond line']},
  dd:        {fx: A, ops: [{sel: [0,11,1,11], text: ''}], exp: ['hello world']},
  delVis:    {fx: A, ops: [{sel: [0,8,1,3], text: ''}], exp: ['hello woond line']},
  J:         {fx: A, ops: [{sel: [0,11,1,0], text: ''}, {text: ' '}], exp: ['hello world second line']},
  insCross:  {fx: A, ops: [{sel: [0,8,1,3], text: 'Z'}], exp: ['hello woZond line']},
  o:         {fx: A, ops: [{sel: [0,11,0,11], text: '\nnew'}], exp: ['hello world', 'new', 'second line']},
  rCR:       {fx: A, ops: [{sel: [0,5,0,6], text: '\n'}], exp: ['hello', 'world', 'second line']},
  split:     {fx: A, ops: [{sel: [0,5,0,5], text: 'A\nB'}], exp: ['helloA', 'B world', 'second line']},
  seq:       {fx: A, ops: [{sel: [0,0,0,0], text: 'ab'}, {sel: [0,4,0,5], text: ''}], exp: ['abhelo world', 'second line']},
  oX:        {fx: A, ops: [{sel: [0,11,0,11], text: '\nx'}], exp: ['hello world', 'x', 'second line']},
  split2:    {fx: A, ops: [{sel: [0,5,0,5], text: 'A\nBC'}], exp: ['helloA', 'BC world', 'second line']},
  insX0:     {fx: A, ops: [{sel: [1,0,1,0], text: 'X'}], exp: ['hello world', 'Xsecond line']},
  insXbold:  {fx: B, ops: [{sel: [0,8,0,8], text: 'x'}], exp: ['hello woxrld end', 'second line']},
  insXend:   {fx: A, ops: [{sel: [0,11,0,11], text: 'x'}], exp: ['hello worldx', 'second line']},
  seqBlocks: {fx: A, ops: [{sel: [0,11,0,11], text: '\nnew'}, {sel: [2,0,2,6], text: ''}], exp: ['hello world', 'new', ' line']},
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch();
async function one(editor, caseName, cfg, phase) {
  const c = CASES[caseName];
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  page.on('console', m => m.type() === 'error' && errs.push('console: ' + m.text().slice(0, 160)));
  await page.goto('http://localhost:8781/'); await page.waitForFunction(() => window.READY);
  await page.evaluate(([e, fx]) => mount(e, fx), [editor, c.fx]); await sleep(150);
  const init = await page.evaluate(() => state());
  const log = await page.evaluate(([cfg, ops]) => write(cfg, ops), [cfg, c.ops]);
  await sleep(350);
  const res = {editor, caseName, cfg, log, after: await page.evaluate(() => state()), exp: c.exp};
  if (phase === 'type') {
    const b = 0;
    await page.evaluate(b => { const n = blocks()[b].textContent.replace(/﻿/g,'').length; sel(b, n, b, n); settle(); }, b); await sleep(250);
    await page.keyboard.type('Q'); await sleep(350);
    res.typed = await page.evaluate(() => state());
    res.typedExp = c.exp.map((t, i) => i === 0 ? t + 'Q' : t);
  }
  if (phase === 'undo') {
    let n = 0; res.undo = [];
    for (n = 1; n <= 3; n++) { await page.evaluate(() => E.undo()); await sleep(250); const s = await page.evaluate(() => state()); res.undo.push(s.model); if (JSON.stringify(s.model) === JSON.stringify(init.model)) break; }
    res.undoN = n; res.undone = await page.evaluate(() => state());
    res.init = init.model;
  }
  res.events = await page.evaluate(() => ({bi: window.BIS || [], input: window.INPUTS || []}));
  res.errs = [...errs, ...(await page.evaluate(() => ERRS))];
  await page.close(); return res;
}
export function classify(r) {
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const {dom, model} = r.after; const init = CASES[r.caseName].fx.map(p => p.map(x => x[0]).join(''));
  if (eq(model, r.exp) && eq(dom, model)) return 'correct';
  if (!eq(dom, model)) return eq(model, init) ? 'diverged(model untouched)' : 'diverged';
  if (eq(model, init)) return 'refused';
  return 'wrong';
}
const editors = (process.env.ED || 'bare,prosemirror,lexical,quill,slate').split(',');
const cfgs = JSON.parse(process.env.CFGS || '[{"mode":"exec"},{"mode":"bi","target":"host","deleteType":"deleteContentBackward"}]');
const cases = (process.env.CASES || Object.keys(CASES).join(',')).split(',');
const phase = process.env.PHASE || 'type';
const jobs = []; for (const e of editors) for (const cfg of cfgs) for (const k of cases) jobs.push([e, k, cfg]);
const out = []; let i = 0;
await Promise.all(Array.from({length: 8}, async () => { while (i < jobs.length) { const j = jobs[i++]; try { const r = await one(j[0], j[1], j[2], phase); r.outcome = classify(r); out.push(r); } catch (e) { out.push({editor: j[0], caseName: j[1], cfg: j[2], fail: String(e).slice(0, 200)}); } } }));
fs.writeFileSync(new URL(process.env.OUT || 'out.json', dir), JSON.stringify(out, null, 1));
for (const e of editors) for (const cfg of cfgs) { console.log(`\n== ${e} ${JSON.stringify(cfg)}`);
  for (const k of cases) { const r = out.find(x => x.editor === e && x.caseName === k && JSON.stringify(x.cfg) === JSON.stringify(cfg));
    if (r.fail) { console.log(k, 'FAIL', r.fail); continue; }
    const steps = r.log.map(s => `${s.cmd}${s.prevented ? '[P]' : s.prevented === false ? '[-]' : ''}${s.exec === undefined ? '' : s.exec ? '+x' : '+x!'}`).join(' ');
    let extra = '';
    if (r.typed) extra += ` | typed ${JSON.stringify(r.typed.model)}${JSON.stringify(r.typed.dom) !== JSON.stringify(r.typed.model) ? ' DOM ' + JSON.stringify(r.typed.dom) : ''}${JSON.stringify(r.typed.model) === JSON.stringify(r.typedExp) ? ' ok' : ' BAD'}`;
    if (r.undo) extra += ` | undo x${r.undoN} -> ${JSON.stringify(r.undone.model)}${JSON.stringify(r.undone.model) === JSON.stringify(r.init) ? ' restored' : ' NOT'}`;
    console.log(`${k.padEnd(10)} ${r.outcome.padEnd(26)} ${steps.padEnd(48)} model ${JSON.stringify(r.after.model)}${JSON.stringify(r.after.dom) !== JSON.stringify(r.after.model) ? ' DOM ' + JSON.stringify(r.after.dom) : ''}${extra}${r.errs.length ? ' ERR ' + JSON.stringify(r.errs) : ''}`);
  } }
await browser.close(); srv.close();
