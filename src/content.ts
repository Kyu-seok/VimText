import { isTextControl, type TextControl } from "./field/Field";
import { TextareaField } from "./field/TextareaField";
import { Session, isActivationKey } from "./bridge/Session";
import { loadSettings, policyFor, watchSettings, type Settings, type SitePolicy } from "./settings/settings";

const sessions = new Map<TextControl, { field: TextareaField; session: Session }>();
let settings: Settings | null = null;

function policy(): SitePolicy {
  return settings ? policyFor(settings, location.origin) : "off";
}

function deepTarget(e: Event): EventTarget | null {
  const path = e.composedPath();
  return path.length ? path[0]! : e.target;
}

function activate(el: TextControl): Session {
  const existing = sessions.get(el);
  if (existing) return existing.session;
  const field = new TextareaField(el);
  const session = new Session(field, { vimrc: settings?.vimrc ?? "" });
  sessions.set(el, { field, session });
  observeLifecycle(el.getRootNode());
  return session;
}

function dispose(el: TextControl): void {
  const entry = sessions.get(el);
  if (!entry) return;
  entry.session.destroy();
  entry.field.destroy();
  sessions.delete(el);
  if (sessions.size === 0) stopObservingLifecycle();
}

// Disposal is prompt (decision record on issue #8): a Session ends when its Field leaves
// the page (framework re-mounts included) or stops qualifying (readonly,
// disabled, type changed to password), not on the next focus change elsewhere.
// The observer runs only while a Session exists, so an inert page costs nothing.
let lifecycleObserver: MutationObserver | null = null;

function isStatusHost(node: Node): boolean {
  return node instanceof Element && node.localName === "vimtext-status";
}

/** True when a record can affect a Session; our own Status Line hosts coming and going cannot. */
function concernsFields(record: MutationRecord): boolean {
  if (record.type === "attributes") return true;
  for (const n of record.addedNodes) if (!isStatusHost(n)) return true;
  for (const n of record.removedNodes) if (!isStatusHost(n)) return true;
  return false;
}

const lifecycleOptions: MutationObserverInit = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["type", "readonly", "disabled"],
};

/**
 * Starts the observer if it is not running and adds the new Field's root to
 * it: records from inside a shadow tree never reach an observer on the
 * document, so a Field in an open shadow root (reached through `composedPath`
 * on activation) is watched at its own root. One observer may observe many
 * targets; `disconnect()` drops them all.
 */
function observeLifecycle(root: Node): void {
  if (!lifecycleObserver) {
    lifecycleObserver = new MutationObserver((records) => {
      if (!records.some(concernsFields)) return;
      for (const el of [...sessions.keys()]) if (!el.isConnected || !isTextControl(el)) dispose(el);
    });
    lifecycleObserver.observe(document, lifecycleOptions);
  }
  if (root instanceof ShadowRoot) lifecycleObserver.observe(root, lifecycleOptions);
}

function stopObservingLifecycle(): void {
  lifecycleObserver?.disconnect();
  lifecycleObserver = null;
}

document.addEventListener(
  "keydown",
  (e) => {
    const target = deepTarget(e);
    if (!isTextControl(target)) return;
    const entry = sessions.get(target);
    if (entry) {
      entry.session.handleKeydown(e);
      return;
    }
    if (policy() === "off" || e.isComposing || !isActivationKey(e)) return;
    e.preventDefault();
    e.stopPropagation();
    activate(target);
  },
  { capture: true },
);

document.addEventListener("focusin", (e) => {
  const target = deepTarget(e);
  if (!isTextControl(target)) return;
  const entry = sessions.get(target);
  if (entry) entry.session.onFocus();
  else if (policy() === "normal") activate(target);
});

document.addEventListener("focusout", (e) => {
  const target = deepTarget(e);
  if (!isTextControl(target)) return;
  sessions.get(target)?.session.onBlur();
});

chrome.runtime.onMessage.addListener((msg: { type?: string }, _sender, sendResponse) => {
  if (msg?.type === "vimtext:status") {
    const active = document.activeElement;
    const entry = isTextControl(active) ? sessions.get(active) : undefined;
    sendResponse({
      origin: location.origin,
      mode: entry?.session.mode ?? null,
      top: window === window.top,
      // The e2e lifecycle spec checks the observer runs only while a Session exists.
      observing: lifecycleObserver !== null,
    });
  }
  return false;
});

void loadSettings().then((s) => {
  settings = s;
});
watchSettings((s) => {
  settings = s;
  if (policy() === "off") for (const el of [...sessions.keys()]) dispose(el);
});
