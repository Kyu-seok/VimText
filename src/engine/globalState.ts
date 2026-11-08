import { Vim } from "@replit/codemirror-vim";
import type {
  InsertModeChangesState,
  InsertModeKeyState,
  RegisterState,
  SessionState,
} from "../settings/sessionState";

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

const V = Vim as unknown as {
  getVimGlobalState_(): GlobalState;
  InsertModeKey: new (keyName: string, e: Omit<InsertModeKeyState, "keyName">) => InsertModeKey;
};

function isInsertModeKey(change: unknown): change is InsertModeKey {
  return change instanceof V.InsertModeKey;
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
      return new V.InsertModeKey(keyName, e);
    }
    return change;
  });
  return {
    changes,
    expectCursorActivityForChange: c.expectCursorActivityForChange,
    ...(c.visualBlock !== undefined ? { visualBlock: c.visualBlock } : {}),
  };
}

function snapshotRegister(r: Register): RegisterState {
  return {
    text: r.toString(),
    linewise: !!r.linewise,
    blockwise: !!r.blockwise,
    insertModeChanges: r.insertModeChanges.map(snapshotChanges),
    searchQueries: [...r.searchQueries],
  };
}

/** Register names sorted, so two tabs serialize the same state the same way. */
export function snapshotGlobalState(): SessionState {
  const g = V.getVimGlobalState_();
  const registers: Record<string, RegisterState> = {};
  for (const name of Object.keys(g.registerController.registers).sort()) {
    registers[name] = snapshotRegister(g.registerController.registers[name]!);
  }
  const latest = g.macroModeState.latestRegister;
  return {
    registers,
    ...(latest !== undefined ? { latestRegister: latest } : {}),
    searchHistory: [...g.searchHistoryController.historyBuffer],
    exHistory: [...g.exCommandHistoryController.historyBuffer],
    lastCharacterSearch: { ...g.lastCharacterSearch },
  };
}

/**
 * Makes the engine's global state the snapshot, in place: the controller
 * objects (and the unnamed register it holds by reference) are kept, their
 * contents replaced. A register the snapshot lacks is cleared, never deleted.
 */
export function restoreGlobalState(s: SessionState): void {
  const g = V.getVimGlobalState_();
  const rc = g.registerController;
  for (const name of Object.keys(rc.registers)) {
    if (!(name in s.registers)) rc.registers[name]!.clear();
  }
  for (const [name, state] of Object.entries(s.registers)) {
    // `getRegister` answers the unnamed register for a name it does not accept.
    if (!rc.registers[name] && !rc.isValidRegister(name)) continue;
    const r = rc.getRegister(name);
    r.setText(state.text, state.linewise, state.blockwise);
    r.insertModeChanges = state.insertModeChanges.map(restoreChanges);
    r.searchQueries = [...state.searchQueries];
  }
  g.macroModeState.latestRegister = s.latestRegister;
  g.searchHistoryController.historyBuffer = [...s.searchHistory];
  g.searchHistoryController.reset();
  g.exCommandHistoryController.historyBuffer = [...s.exHistory];
  g.exCommandHistoryController.reset();
  g.lastCharacterSearch = { ...s.lastCharacterSearch };
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
