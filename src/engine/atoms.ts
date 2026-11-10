import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Vim } from "@replit/codemirror-vim";

/**
 * Atoms in the engine's registers (DESIGN.md "contenteditable Fields",
 * _Atoms_; docs/engine-seams.md, Atoms in registers): the mirror's text holds
 * each Atom as one U+FFFC, and a register stores the Atom's visible text
 * instead.
 *
 * The engine's operators read the text they store through the adapter's
 * `getRange`/`getSelection` and hand it to `RegisterController.pushText`,
 * which carries no position. So the mirror notes each read that holds a
 * U+FFFC together with the visible text of the Atoms at those positions
 * (`noteRead`), and the register write substitutes from the newest read the
 * stored text came from (`visibleText`). A U+FFFC that is not a known Atom (a
 * literal one in a textarea) is left alone.
 */

const ATOM_CHAR = "\uFFFC";

/** An Atom of the Field's text: its offset and the visible text a register stores for it. */
export interface AtomAt {
  readonly offset: number;
  readonly text: string;
}

export const setAtoms = StateEffect.define<readonly AtomAt[]>();

/**
 * The Atoms of the mirror's text by offset, as the bridge last read them from
 * the Field (`setAtoms`), mapped through every change since: a command that
 * edits before an Atom and then yanks it still finds it. A change that
 * touches an Atom's character drops it until the next read from the Field.
 */
export const atomTable = StateField.define<ReadonlyMap<number, string>>({
  create: () => new Map(),
  update(table, tr) {
    for (const e of tr.effects) {
      if (e.is(setAtoms)) return new Map(e.value.map((a) => [a.offset, a.text]));
    }
    if (!tr.docChanged || table.size === 0) return table;
    const next = new Map<number, string>();
    for (const [pos, text] of table) {
      let touched = false;
      tr.changes.iterChangedRanges((fromA, toA) => {
        if (fromA < pos + 1 && toA > pos) touched = true;
      });
      if (!touched) next.set(tr.changes.mapPos(pos, 1), text);
    }
    return next;
  },
});

/** Whether `atoms` is what the table already holds. */
export function sameAtoms(table: ReadonlyMap<number, string>, atoms: readonly AtomAt[]): boolean {
  return table.size === atoms.length && atoms.every((a) => table.get(a.offset) === a.text);
}

interface AtomRead {
  text: string;
  /** Per U+FFFC of `text`, in order: the Atom's visible text, or undefined for a literal one. */
  atoms: (string | undefined)[];
}

/** The latest reads holding a U+FFFC, newest last; one register write consumes them. */
const reads: AtomRead[] = [];
const READS_KEPT = 8;

/** Records that the engine read `from`..`to` of `state`'s text. */
export function noteRead(state: EditorState, ranges: readonly { from: number; to: number }[]): void {
  const table = state.field(atomTable, false);
  if (!table || table.size === 0) return;
  const atoms: (string | undefined)[] = [];
  const texts = ranges.map(({ from, to }) => {
    const text = state.sliceDoc(Math.min(from, to), Math.max(from, to));
    for (let i = text.indexOf(ATOM_CHAR); i >= 0; i = text.indexOf(ATOM_CHAR, i + 1)) {
      atoms.push(table.get(Math.min(from, to) + i));
    }
    return text;
  });
  if (atoms.length === 0) return;
  reads.push({ text: texts.join("\n"), atoms });
  if (reads.length > READS_KEPT) reads.shift();
}

/**
 * The text a register stores for `text`: each Atom's U+FFFC replaced by its
 * visible text. `text` is the newest matching read, or its start (`cw` drops
 * trailing whitespace), with a linewise register's `\n` added.
 */
function visibleText(text: string): string {
  if (!text.includes(ATOM_CHAR)) return text;
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  for (let r = reads.length - 1; r >= 0; r--) {
    const read = reads[r]!;
    if (!read.text.startsWith(text) && !read.text.startsWith(body)) continue;
    let k = 0;
    return text.replace(/\uFFFC/g, (c) => read.atoms[k++] ?? c);
  }
  return text;
}

interface RegisterController {
  pushText(name: string | null | undefined, operator: string, text: string, ...rest: unknown[]): void;
  unnamedRegister: { setText(text: string, ...rest: unknown[]): void };
}

const hooked = new WeakSet<object>();

/**
 * Hooks the engine's register writes, once per register controller (it is
 * page-global state, docs/engine-seams.md): `pushText` for every yank,
 * delete and change (and so the `"+` clipboard write inside it), and the
 * unnamed register's `setText` for the text a Visual `p` replaces.
 */
export function installAtomRegisters(): void {
  const controller = (
    Vim as unknown as { getRegisterController(): RegisterController }
  ).getRegisterController();
  if (hooked.has(controller)) return;
  hooked.add(controller);
  const pushText = controller.pushText.bind(controller);
  controller.pushText = (name, operator, text, ...rest) => {
    const visible = visibleText(text);
    reads.length = 0;
    pushText(name, operator, visible, ...rest);
  };
  const unnamed = controller.unnamedRegister;
  const setText = unnamed.setText.bind(unnamed);
  unnamed.setText = (text, ...rest) => setText(visibleText(text), ...rest);
}
