/**
 * Session State (GLOSSARY.md): the engine's global state every tab shares for
 * as long as the browser session lasts, kept under one key in
 * `chrome.storage.session`. Plain data: the snapshot and restore live in
 * `src/engine/globalState.ts`.
 */

/** One Insert-mode special key inside a recorded macro (the engine's `InsertModeKey`). */
export interface InsertModeKeyState {
  keyName: string;
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** One Insert session as a macro replays it: typed text, special keys, and ranged replacements. */
export interface InsertModeChangesState {
  changes: (string | [string, number?] | { insertModeKey: InsertModeKeyState })[];
  expectCursorActivityForChange: boolean;
  visualBlock?: number;
}

export interface RegisterState {
  text: string;
  linewise: boolean;
  blockwise: boolean;
  insertModeChanges: InsertModeChangesState[];
  searchQueries: string[];
}

export interface SessionState {
  /** By register name, as the engine keys them (lowercase; `"` `0`-`9` `-` `.` `:` `/` `+`). */
  registers: Record<string, RegisterState>;
  /** The register `@@` replays. */
  latestRegister?: string;
  searchHistory: string[];
  exHistory: string[];
  lastCharacterSearch: { increment: number; forward: boolean; selectedCharacter: string };
}

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
