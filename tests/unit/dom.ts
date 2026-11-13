/**
 * What a unit test observes on the page, and how it drives it, when it goes
 * through the content entry's class rather than one Session (CODING_STANDARDS
 * rule 6): the Status Line text the user sees, keydowns on an element as the
 * browser would dispatch them, and a wait for the microtasks a port resolves on.
 */

/** What the user sees on the one Status Line host, "" when none is shown. The unit twin of the e2e `statusText`. */
export function statusText(): string {
  const host = document.querySelector("vimtext-status") as HTMLElement | null;
  const bar = host?.shadowRoot?.querySelector(".bar");
  return bar && host!.style.display !== "none" ? (bar.textContent ?? "") : "";
}

/** Each Status Line on the page, whether it is shown: a page with several Fields (a Notion page's blocks) has one per Session. */
export function shownStatusBars(): boolean[] {
  return [...document.querySelectorAll<HTMLElement>("vimtext-status")].map((h) => h.style.display !== "none");
}

export function hostCount(): number {
  return document.querySelectorAll("vimtext-status").length;
}

export function keydown(el: Element, key: string, init: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true, ...init });
  el.dispatchEvent(e);
  return e;
}

export function keys(el: Element, seq: string): void {
  for (const ch of seq) keydown(el, ch);
}

/** Enough turns of the microtask queue for a resolved load and a queued snapshot to be handled. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}
