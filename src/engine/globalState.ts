import { Vim } from "@replit/codemirror-vim";
/** One Insert-mode special key inside a recorded macro (the engine's `InsertModeKey`). */
interface InsertModeKeyState {
  keyName: string;
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** One Insert session as a macro replays it: typed text, special keys, and ranged replacements. */
interface InsertModeChangesState {
  changes: (string | [string, number?] | { insertModeKey: InsertModeKeyState })[];
  expectCursorActivityForChange: boolean;
  visualBlock?: number;
}

interface RegisterState {
  text: string;
  linewise: boolean;
  blockwise: boolean;
  insertModeChanges: InsertModeChangesState[];
  searchQueries: string[];
}

/** Session State (GLOSSARY.md) as plain data: what `chrome.storage.session` holds and every tab restores. */
export interface SessionState {
  /** By register name, as the engine keys them (lowercase; `"` `0`-`9` `-` `.` `:` `/` `+`). */
  registers: Record<string, RegisterState>;
  /** The register `@@` replays. */
  latestRegister?: string;
  searchHistory: string[];
  exHistory: string[];
  lastCharacterSearch: { increment: number; forward: boolean; selectedCharacter: string };
}

/**
 * The slice of the engine's global state (one object per page, shared by
 * every mirror) that is Session State: registers with the macros and search
 * queries they carry, both histories, the last `f`/`t` search. The jump list
 * stays out (per-Field positions). See the global-state seam in
 * docs/engine-seams.md.
 */

interface InsertModeKey extends InsertModeKeyState {}

interface InsertModeChanges {
  changes: (string | [string, number?] | InsertModeKey)[];
  expectCursorActivityForChange: boolean;
  visualBlock?: number;
}

interface Register {
  linewise: boolean;
  blockwise: boolean;
  insertModeChanges: InsertModeChanges[];
  searchQueries: string[];
  setText(text: string, linewise?: boolean, blockwise?: boolean): void;
  clear(): void;
  toString(): string;
}

interface HistoryController {
  historyBuffer: string[];
  reset(): void;
}

interface GlobalState {
  macroModeState: { latestRegister: string | undefined };
  registerController: {
    registers: Record<string, Register>;
    getRegister(name: string): Register;
    isValidRegister(name: string): boolean;
  };
  searchHistoryController: HistoryController;
  exCommandHistoryController: HistoryController;
  lastCharacterSearch: { increment: number; forward: boolean; selectedCharacter: string };
}

const engine = Vim as unknown as {
  getVimGlobalState_(): GlobalState;
  InsertModeKey: new (keyName: string, e: Omit<InsertModeKeyState, "keyName">) => InsertModeKey;
};

function isInsertModeKey(change: unknown): change is InsertModeKey {
  return change instanceof engine.InsertModeKey;
}

function snapshotChanges(c: InsertModeChanges): InsertModeChangesState {
  const changes = c.changes.map((change) => {
    if (isInsertModeKey(change)) {
      const { keyName, key, ctrlKey, altKey, metaKey, shiftKey } = change;
      return { insertModeKey: { keyName, key, ctrlKey, altKey, metaKey, shiftKey } };
    }
    return change;
  });
  return {
    changes,
    expectCursorActivityForChange: c.expectCursorActivityForChange,
    ...(c.visualBlock !== undefined ? { visualBlock: c.visualBlock } : {}),
  };
}

/** Macro replay tells a special key from typed text by `instanceof`, so the class is rebuilt. */
function restoreChanges(c: InsertModeChangesState): InsertModeChanges {
  const changes = c.changes.map((change) => {
    if (typeof change === "object" && !Array.isArray(change) && "insertModeKey" in change) {
      const { keyName, ...e } = change.insertModeKey;
      return new engine.InsertModeKey(keyName, e);
    }
    return change;
  });
  return {
    changes,
    expectCursorActivityForChange: c.expectCursorActivityForChange,
    ...(c.visualBlock !== undefined ? { visualBlock: c.visualBlock } : {}),
  };
}

function snapshotRegister(register: Register): RegisterState {
  return {
    text: register.toString(),
    linewise: !!register.linewise,
    blockwise: !!register.blockwise,
    insertModeChanges: register.insertModeChanges.map(snapshotChanges),
    searchQueries: [...register.searchQueries],
  };
}

/** Register names sorted, so two tabs serialize the same state the same way. */
export function snapshotGlobalState(): SessionState {
  const global = engine.getVimGlobalState_();
  const registers: Record<string, RegisterState> = {};
  for (const name of Object.keys(global.registerController.registers).sort()) {
    registers[name] = snapshotRegister(global.registerController.registers[name]!);
  }
  const latest = global.macroModeState.latestRegister;
  return {
    registers,
    ...(latest !== undefined ? { latestRegister: latest } : {}),
    searchHistory: [...global.searchHistoryController.historyBuffer],
    exHistory: [...global.exCommandHistoryController.historyBuffer],
    lastCharacterSearch: { ...global.lastCharacterSearch },
  };
}

/**
 * Makes the engine's global state the snapshot, in place: the controller
 * objects (and the unnamed register it holds by reference) are kept, their
 * contents replaced. A register the snapshot lacks is cleared, never deleted.
 */
export function restoreGlobalState(s: SessionState): void {
  const global = engine.getVimGlobalState_();
  const controller = global.registerController;
  for (const name of Object.keys(controller.registers)) {
    if (!(name in s.registers)) controller.registers[name]!.clear();
  }
  for (const [name, state] of Object.entries(s.registers)) {
    // `getRegister` answers the unnamed register for a name it does not accept.
    if (!controller.registers[name] && !controller.isValidRegister(name)) continue;
    const register = controller.getRegister(name);
    register.setText(state.text, state.linewise, state.blockwise);
    register.insertModeChanges = state.insertModeChanges.map(restoreChanges);
    register.searchQueries = [...state.searchQueries];
  }
  global.macroModeState.latestRegister = s.latestRegister;
  global.searchHistoryController.historyBuffer = [...s.searchHistory];
  global.searchHistoryController.reset();
  global.exCommandHistoryController.historyBuffer = [...s.exHistory];
  global.exCommandHistoryController.reset();
  global.lastCharacterSearch = { ...s.lastCharacterSearch };
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** `history` with `added` pushed as the engine pushes input: moved to the end if already there. */
function pushAll(history: string[], added: string[]): string[] {
  const out = [...history];
  for (const entry of added) {
    const i = out.indexOf(entry);
    if (i >= 0) out.splice(i, 1);
    out.push(entry);
  }
  return out;
}

/**
 * The state read from storage with everything this tab changed since
 * `before` laid over it: the read answers what the browser session held
 * before this tab's first key, so a register, history entry or last search
 * the keys produced in the meantime is newer than it. A register the keys
 * left alone takes the loaded value.
 */
export function overlayLocalChanges(
  loaded: SessionState,
  local: SessionState,
  before: SessionState,
): SessionState {
  const registers: Record<string, RegisterState> = {};
  for (const name of [
    ...new Set([...Object.keys(loaded.registers), ...Object.keys(local.registers)]),
  ].sort()) {
    const mine = local.registers[name];
    const changed = mine !== undefined && !same(mine, before.registers[name]);
    registers[name] = (changed ? mine : (loaded.registers[name] ?? mine))!;
  }
  const latest = same(local.latestRegister, before.latestRegister)
    ? loaded.latestRegister
    : local.latestRegister;
  return {
    registers,
    ...(latest !== undefined ? { latestRegister: latest } : {}),
    searchHistory: pushAll(
      loaded.searchHistory,
      local.searchHistory.filter((q) => !before.searchHistory.includes(q)),
    ),
    exHistory: pushAll(
      loaded.exHistory,
      local.exHistory.filter((q) => !before.exHistory.includes(q)),
    ),
    lastCharacterSearch: same(local.lastCharacterSearch, before.lastCharacterSearch)
      ? { ...loaded.lastCharacterSearch }
      : { ...local.lastCharacterSearch },
  };
}
