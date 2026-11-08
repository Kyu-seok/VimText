import type { Session } from "../../src/bridge/Session";

/**
 * Drives a Session with synthetic keydowns the way the content script's
 * capture listener does. Takes a getter because the tests rebuild the Session
 * in `beforeEach`.
 */
export function keyDriver(session: () => Session) {
  function keydown(key: string, init: Partial<KeyboardEventInit> = {}): KeyboardEvent {
    const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true, ...init });
    session().handleKeydown(e);
    return e;
  }
  function keys(seq: string): void {
    for (const ch of seq) keydown(ch);
  }
  return { keydown, keys };
}
