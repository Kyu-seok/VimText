// ISOLATED world. Same write algorithm as page.html's write(), but run here.
document.documentElement.setAttribute('data-vt-cs', 'loaded');
const host = () => document.activeElement.closest('[contenteditable="true"]') || document.activeElement;
const blocks = () => Array.from(host().children);
const textAt = (bi, off) => { const w = document.createTreeWalker(blocks()[bi], NodeFilter.SHOW_TEXT); let n, last = null;
  while ((n = w.nextNode())) { if (n.parentElement.closest('[data-slate-zero-width],.ql-cursor')) continue; last = n; if (off <= n.data.length) return [n, off]; off -= n.data.length; }
  return last ? [last, last.data.length] : [blocks()[bi], 0]; };
const settle = () => document.dispatchEvent(new Event('selectionchange'));
const sel = (b1,o1,b2,o2) => { const [a,ao]=textAt(b1,o1), [f,fo]=textAt(b2,o2); document.getSelection().setBaseAndExtent(a,ao,f,fo); };
function step(cfg, cmd, value, log) {
  const s = document.getSelection(); const r = s.getRangeAt(0); const rec = {cmd, value};
  if (cfg.mode !== 'exec') {
    const inputType = cmd === 'insertText' ? 'insertText' : cmd === 'insertParagraph' ? 'insertParagraph' : cfg.deleteType;
    const ev = new InputEvent('beforeinput', {inputType, data: cmd === 'insertText' ? value : null, bubbles: true, cancelable: true, composed: true,
      targetRanges: [new StaticRange({startContainer: r.startContainer, startOffset: r.startOffset, endContainer: r.endContainer, endOffset: r.endOffset})]});
    host().dispatchEvent(ev);
    rec.prevented = ev.defaultPrevented;
    rec.csSeesRanges = ev.getTargetRanges().length;
  }
  if (cfg.mode === 'exec' || !rec.prevented) rec.exec = document.execCommand(cmd, false, value);
  settle(); log.push(rec);
}
window.addEventListener('message', async (e) => {
  const w = e.data && e.data.vtWrite; if (!w) return;
  const {cfg, ops} = w; const log = []; const steps = [];
  for (const op of ops) { if (op.sel) steps.push(['sel', op.sel]);
    if (op.text === '') steps.push(['cmd', 'delete']);
    else op.text.split('\n').forEach((part, i) => { if (i > 0) steps.push(['cmd', 'insertParagraph']); if (part) steps.push(['cmd', 'insertText', part]); }); }
  for (let i = 0; i < steps.length; i++) {
    if (i > 0 && cfg.timing === 'ms20') await new Promise(r => setTimeout(r, 20));
    const s = steps[i]; if (s[0] === 'sel') { sel(...s[1]); settle(); } else step(cfg, s[1], s[2], log);
  }
  window.postMessage({vtDone: log}, '*');
});
