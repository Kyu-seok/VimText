import { type ChangeSet, EditorSelection, EditorState, type Extension, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, undoDepth } from "@codemirror/commands";
import { vim, getCM, Vim } from "@replit/codemirror-vim";
import type { WrappingStyle } from "../field/Field";
import { diffText } from "../field/diff";
import { modeFromEngine, type Mode } from "./mode";
import { atomTable, installAtomRegisters, noteRead, sameAtoms, setAtoms, type AtomAt } from "./atoms";

/** The slice of the adapter's CM5-style object the bridge relies on. */
interface VimCM {
  state: {
    vim?: VimState | null;
    statusbar?: Element | null;
    dialog?: HTMLElement | null;
    overwrite?: boolean;
    vimPlugin?: VimPlugin;
  };
  on(type: string, f: (...args: any[]) => void): void;
  off(type: string, f: (...args: any[]) => void): void;
  focus(): void;
  getInputField(): HTMLElement;
  getRange(from: unknown, to: unknown): string;
  getSelection(): string;
  indexFromPos(pos: unknown): number;
  openNotification(template: Node, options: { bottom?: boolean; duration?: number }): () => void;
}

interface VimState {
  insertMode: boolean;
  visualMode: boolean;
  visualLine: boolean;
  visualBlock: boolean;
  insertModeReturn: boolean;
  mode?: string;
  status: string;
  inputState: {
    keyBuffer: string[];
    operator: string | null | undefined;
    prefixRepeat: string[];
    /** The register named by a `"x` prefix, until the command completes. */
    registerName?: string | null;
  };
}

interface VimPlugin {
  handleKey(e: KeyLike, view: EditorView): boolean;
  updateStatus(): void;
}

/** What the adapter reads off a keydown event. */
export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

interface MirrorOptions {
  /** Element (inside VimText's shadow root) to mount the hidden view in. */
  container: HTMLElement;
  /** The Field's real element; the engine attaches its Insert-mode key recorder here. */
  inputField: HTMLElement;
  /** Called whenever the engine wants focus back (after a dialog closes, etc). */
  focus(): void;
  doc: string;
  cursor: number;
  style: WrappingStyle;
  /** Element the engine renders mode text, pending keys, and dialogs into. */
  statusbar: HTMLElement;
}

/** Normal-mode cursors sit on a character, never past the end of a non-empty line. */
export function clipToLine(doc: Text, pos: number): number {
  pos = Math.max(0, Math.min(doc.length, pos));
  const line = doc.lineAt(pos);
  return pos === line.to && line.length > 0 ? pos - 1 : pos;
}

/**
 * A hidden CodeMirror 6 view running the Vim engine. The bridge feeds it keys
 * and reads its document/selection back; it is never shown to the user.
 */

/** Told of each mirror update: whether the text and the selection changed, and the text's changes. */
type UpdateHandler = (docChanged: boolean, selectionSet: boolean, changes: ChangeSet) => void;
export class Mirror {
  readonly view: EditorView;
  readonly cm: VimCM;
  readonly plugin: VimPlugin;
  private updateHandlers = new Set<UpdateHandler>();

  constructor(opts: MirrorOptions) {
    const updateListener: Extension = EditorView.updateListener.of((u) => {
      for (const h of this.updateHandlers) h(u.docChanged, u.selectionSet, u.changes);
    });
    this.view = new EditorView({
      state: EditorState.create({
        doc: opts.doc,
        selection: { anchor: Math.min(opts.cursor, opts.doc.length) },
        extensions: [
          vim(),
          history(),
          EditorView.lineWrapping,
          EditorState.allowMultipleSelections.of(true),
          updateListener,
          atomTable,
          EditorView.theme({
            ".cm-content": { padding: "0" },
            ".cm-line": { padding: "0" },
            ".cm-scroller": { overflow: "hidden" },
          }),
        ],
      }),
      parent: opts.container,
      root: opts.container.getRootNode() as Document | ShadowRoot,
    });
    const cm = getCM(this.view) as unknown as VimCM | null;
    if (!cm?.state.vimPlugin) throw new Error("VimText: vim plugin failed to initialise");
    this.cm = cm;
    this.plugin = cm.state.vimPlugin;

    // The engine must hand focus to the real Field, never to the hidden view,
    // and must record Insert-mode Backspace/Delete from the real Field.
    cm.focus = () => opts.focus();
    cm.getInputField = () => opts.inputField;

    this.noteAtomReads();

    cm.state.statusbar = opts.statusbar;
    this.plugin.updateStatus();
    this.applyStyle(opts.style);
  }

  /**
   * Every text the engine reads to store in a register passes through
   * `getRange` or `getSelection`; noting the Atoms in it lets the register
   * write store their visible text (docs/engine-seams.md, Atoms in registers).
   */
  private noteAtomReads(): void {
    installAtomRegisters();
    const cm = this.cm;
    const getRange = cm.getRange.bind(cm);
    const getSelection = cm.getSelection.bind(cm);
    cm.getRange = (s, e) => {
      noteRead(this.view.state, [{ from: cm.indexFromPos(s), to: cm.indexFromPos(e) }]);
      return getRange(s, e);
    };
    cm.getSelection = () => {
      noteRead(this.view.state, this.view.state.selection.ranges);
      return getSelection();
    };
  }

  /** The Field's Atoms, read now that the mirror's text is the Field's. */
  setAtoms(atoms: readonly AtomAt[]): void {
    if (sameAtoms(this.view.state.field(atomTable), atoms)) return;
    this.view.dispatch({ effects: setAtoms.of(atoms) });
  }

  get vim(): VimState {
    const v = this.cm.state.vim;
    if (!v) throw new Error("VimText: vim state missing");
    return v;
  }

  /** The engine's Mode; Command-line is the bridge's call (see `commandLineOpen`). */
  get mode(): Mode {
    return modeFromEngine(this.vim.mode);
  }

  /** Copies the Field's wrapping-relevant styles so display lines match. */
  applyStyle(style: WrappingStyle): void {
    const content = this.view.contentDOM;
    content.style.font = style.font;
    content.style.letterSpacing = style.letterSpacing;
    content.style.lineHeight = style.lineHeight;
    content.style.whiteSpace = style.whiteSpace;
    content.style.wordBreak = style.wordBreak;
    content.style.overflowWrap = style.overflowWrap;
    content.style.tabSize = style.tabSize;
    this.view.dom.style.width = `${style.contentWidth}px`;
    // The mirror sits offscreen, where CodeMirror skips measuring unless a
    // scroll target is set: without one, line heights stay estimates and the
    // first `j` on long unwrapped lines lands at the end of the text
    // (docs/engine-seams.md, Layout).
    this.view.dispatch({ effects: EditorView.scrollIntoView(this.view.state.selection.main.head) });
  }

  onUpdate(handler: UpdateHandler): () => void {
    this.updateHandlers.add(handler);
    return () => this.updateHandlers.delete(handler);
  }

  /** Feeds one key to the engine. Returns true if Vim consumed it. */
  handleKey(e: KeyLike): boolean {
    return this.plugin.handleKey(e, this.view);
  }

  /**
   * The Status Line shows the keys as typed, never a Plugin Key's name
   * (DESIGN.md "Plugins"): the adapter appends every key name it receives to
   * `vim.status`, the pending-keys text it renders until the command is done.
   */
  showTypedKeys(pluginKey: string, typed: string): void {
    const vim = this.vim;
    if (!vim.status.includes(pluginKey)) return;
    vim.status = vim.status.split(pluginKey).join(typed);
    this.plugin.updateStatus();
  }

  /** How many undo steps the mirror's history holds; the bridge notes it whenever it agrees with the Field. */
  undoDepth(): number {
    return undoDepth(this.view.state);
  }

  /**
   * Takes back the changes made since the history held `depth` steps, as `u`
   * would, so no later `u` finds them (a refused edit, #48). With no new step
   * the change joined the last one (docs/engine-seams.md "History grouping"),
   * which goes too: the caller writes back what of it the Field kept.
   */
  private undoSince(depth: number): void {
    let steps = Math.max(1, undoDepth(this.view.state) - depth);
    while (steps-- > 0 && undo(this.view));
  }

  /**
   * Takes back the changes since `depth` (`undoSince`) and makes the text
   * `kept`, the part of a joined step the Field did keep, in a step of its
   * own, the Normal cursor where the taken-back command left it. The undo
   * restores the selection the command started from (`x`'s covers its
   * character, which the engine would take for Visual), so the cursor is
   * dispatched in the same breath (docs/engine-seams.md "Taking a change back").
   */
  takeBackSince(depth: number, kept: string): void {
    const head = this.view.state.selection.main.head;
    this.undoSince(depth);
    const state = this.view.state;
    const doc = state.doc.toString();
    const { start, endOld, endNew } = diffText(doc, kept);
    const changes = state.changes(
      kept === doc ? [] : { from: start, to: endOld, insert: kept.slice(start, endNew) },
    );
    const newDoc = changes.apply(state.doc);
    this.view.dispatch({
      changes,
      selection: EditorSelection.cursor(clipToLine(newDoc, Math.min(head, newDoc.length))),
      userEvent: "input.type",
    });
  }

  /** Runs an ex command line (without the leading colon). */
  handleEx(line: string): void {
    (Vim as unknown as { handleEx(cm: VimCM, input: string): void }).handleEx(this.cm, line);
  }

  /** Removes every user mapping in every context; mappings are global per frame, not per mirror. */
  clearUserMappings(): void {
    (Vim as unknown as { mapclear(ctx?: string): void }).mapclear();
  }

  /** The engine's open command line or notice, if any. */
  get dialog(): HTMLElement | null {
    return this.cm.state.dialog ?? null;
  }

  /** True while the `:` `/` `?` input is open (it takes focus from the Field). */
  commandLineOpen(): boolean {
    return !!this.dialog?.querySelector("input");
  }

  notify(text: string, durationMs = 4000): void {
    const span = document.createElement("span");
    span.textContent = text;
    this.cm.openNotification(span, { bottom: true, duration: durationMs });
  }

  destroy(): void {
    this.view.destroy();
  }
}

export { Vim };
