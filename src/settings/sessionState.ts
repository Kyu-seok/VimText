/**
 * Session State (GLOSSARY.md): the engine's global state every tab shares for
 * as long as the browser session lasts, kept under one key in
 * `chrome.storage.session`. The shape, snapshot and restore live in
 * `src/engine/globalState.ts`; this is the storage adapter.
 */

import type { SessionState } from "../engine/globalState";

const KEY = "sessionState";

export async function loadSessionState(): Promise<SessionState | null> {
  const stored = (await chrome.storage.session.get(KEY)) as { sessionState?: SessionState };
  return stored.sessionState ?? null;
}

export async function saveSessionState(state: SessionState): Promise<void> {
  await chrome.storage.session.set({ [KEY]: state });
}

/** Calls `handler` with the state whenever any tab writes it, this one included. */
export function watchSessionState(handler: (s: SessionState) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== "session" || !(KEY in changes)) return;
    const next = changes[KEY]?.newValue as SessionState | undefined;
    if (next) handler(next);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
