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

/**
 * `keyDriver` for a Field whose writes settle asynchronously (a contenteditable
 * host, ADR 0008): each key is pressed once the writes of the keys before it
 * have settled, as a person typing at a normal pace would.
 */
export function settledKeyDriver(session: () => Session) {
  const now = keyDriver(session);
  async function keydown(key: string, init: Partial<KeyboardEventInit> = {}): Promise<KeyboardEvent> {
    const e = now.keydown(key, init);
    await session().settled();
    return e;
  }
  async function keys(seq: string): Promise<void> {
    for (const ch of seq) await keydown(ch);
  }
  return { keydown, keys };
}
