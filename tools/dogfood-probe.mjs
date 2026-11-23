// The page-side probe an agent injects before it types on a live site in a dogfooding pass
// (docs/release.md, "An agent driving the pass").
//
//   npm run -s dogfood:probe     prints the script to run in the page (Claude in Chrome's
//                                javascript tool); it leaves `window.__vimtextProbe` behind
//
// In the page, after injecting:
//
//   __vimtextProbe.watch(field, { enterSends: true })   the Field under test, focused
//   __vimtextProbe.state()                              JSON to assert on after each step
//
// Why it exists: in the 0.4.2 pass (#96) focus left Gmail's compose body between two keys
// of one batch of tool calls; the batch could not stop on a failed read, the keys that
// followed ran Gmail's shortcuts, and five conversations were marked read (#108). From
// `watch` on, a key that arrives while focus is outside the Field is stopped before the
// page sees it and listed under `leaks`. With `enterSends`, so is an Enter that reaches
// the Field itself (Slack sends on it): VimText stops the keys it handles first, so an
// Enter this listener sees is one the site would act on. A non-empty `leaks` ends the run
// on that site: read it after every batch.
//
// `state()` returns only what the steps assert, never the page's title or URL: the tool
// withholds a result that holds an address or a query string.
/** Runs in the page: self-contained, since it is injected as text. */
export function installProbe() {
  /** @type {HTMLElement | null} */
  let field = null;
  let enterSends = false;
  /** @type {string[]} */
  const leaks = [];
  /** @type {string[]} */
  const focus = [];
  const started = performance.now();

  /** @param {Element | null} el */
  const name = (el) => {
    if (!el) return "none";
    if (el === field) return "FIELD";
    const role = el.getAttribute("role");
    return el.tagName.toLowerCase() + (role ? `[${role}]` : "");
  };
  /** @param {Element | null} el */
  const inVimText = (el) => !!el && el.tagName.startsWith("VIMTEXT-");
  /** Notion focuses the editable root around a block; the block is the Field. */
  const fieldHasFocus = () => {
    const active = document.activeElement;
    if (!field || !active) return false;
    if (active === field || field.contains(active)) return true;
    return active instanceof HTMLElement && active.isContentEditable && active.contains(field);
  };

  window.addEventListener(
    "keydown",
    (e) => {
      if (!field || inVimText(document.activeElement)) return;
      const sends = enterSends && e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey;
      if (fieldHasFocus() && !sends) return;
      leaks.push(`${e.key} at ${name(document.activeElement)}`);
      e.stopImmediatePropagation();
      e.preventDefault();
    },
    true,
  );
  for (const type of ["focusin", "focusout"]) {
    document.addEventListener(
      type,
      (e) => {
        if (!field) return;
        const to = e instanceof FocusEvent && e.relatedTarget instanceof Element ? e.relatedTarget : null;
        const target = e.target instanceof Element ? e.target : null;
        focus.push(
          `${Math.round(performance.now() - started)}ms ${type} ${name(target)} (other: ${name(to)})`,
        );
      },
      true,
    );
  }

  const statusBars = () =>
    [...document.querySelectorAll("vimtext-status")]
      .filter((host) => host instanceof HTMLElement && !host.hidden)
      .map((host) => {
        const root = host.shadowRoot;
        const input = root?.querySelector("input");
        const typed = input && input.getClientRects().length ? input.value : "";
        return (root?.querySelector(".bar")?.textContent ?? "") + typed;
      });

  const selection = () => {
    if (!field) return null;
    if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) {
      return { start: field.selectionStart, end: field.selectionEnd };
    }
    const sel = document.getSelection();
    if (!sel || !sel.anchorNode || !field.contains(sel.anchorNode)) return null;
    const before = document.createRange();
    before.selectNodeContents(field);
    before.setEnd(sel.anchorNode, sel.anchorOffset);
    return { start: before.toString().length, collapsed: sel.isCollapsed };
  };

  const probe = {
    /**
     * @param {HTMLElement} el
     * @param {{ enterSends?: boolean }} [options]
     */
    watch(el, options = {}) {
      field = el;
      enterSends = !!options.enterSends;
      leaks.length = 0;
      focus.length = 0;
      el.focus();
    },
    state() {
      const text =
        field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement
          ? field.value
          : (field?.innerText ?? null);
      return JSON.stringify({
        text,
        html: field && !("value" in field) && field.innerHTML.length < 600 ? field.innerHTML : undefined,
        selection: selection(),
        focused: fieldHasFocus(),
        active: name(document.activeElement),
        status: statusBars(),
        leaks: leaks.splice(0),
        focus: focus.splice(0),
      });
    },
  };
  Object.assign(window, { __vimtextProbe: probe });
  return probe;
}

// No Node import above: the unit test loads this file in Chromium, where `process` does not exist.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("dogfood-probe.mjs")) {
  process.stdout.write(`(${installProbe.toString()})(); "probe installed"\n`);
}
