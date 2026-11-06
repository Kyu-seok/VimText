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
  return session;
}

function dispose(el: TextControl): void {
  const entry = sessions.get(el);
  if (!entry) return;
  entry.session.destroy();
  entry.field.destroy();
  sessions.delete(el);
}

function sweep(): void {
  for (const el of sessions.keys()) if (!el.isConnected) dispose(el);
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
  sweep();
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
    sendResponse({ origin: location.origin, mode: entry?.session.mode ?? null, top: window === window.top });
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
