import { EditorSelection, type Text } from "@codemirror/state";
import type { Field } from "../field/Field";
import { Mirror, Vim, type KeyLike } from "../engine/mirror";
import { StatusLine } from "../ui/StatusLine";

export interface SessionConfig {
  vimrc: string;
}

/** Keys VimText takes from the Field while in Insert mode. Everything else is native. */
function isInsertModeVimKey(e: KeyboardEvent): boolean {
  if (e.key === "Escape") return true;
  if (!e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key === "[" || e.key === "o" || e.key === "r" || e.key === "u" || e.key === "w";
}

export function isActivationKey(e: KeyboardEvent): boolean {
  return e.key === "Escape" || (e.ctrlKey && !e.metaKey && !e.altKey && e.key === "[");
}

/** The adapter maps <C-[> to <Esc> itself, but normalising here keeps the policy checks simple. */
function toEngineKey(e: KeyboardEvent): KeyLike {
  const esc = e.key === "Escape" || (e.ctrlKey && e.key === "[");
  return {
    key: esc ? "Escape" : e.key,
    code: e.code,
    ctrlKey: esc ? false : e.ctrlKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
    shiftKey: e.shiftKey,
    preventDefault: () => e.preventDefault(),
    stopPropagation: () => e.stopPropagation(),
  };
}

/** Normal-mode cursors sit on a character, never past the end of a non-empty line. */
function clipToLine(doc: Text, pos: number): number {
  pos = Math.max(0, Math.min(doc.length, pos));
  const line = doc.lineAt(pos);
  return pos === line.to && line.length > 0 ? pos - 1 : pos;
}

let exCommandsDefined = false;
function defineExCommands(): void {
  if (exCommandsDefined) return;
  exCommandsDefined = true;
  const V = Vim as unknown as {
    defineEx(name: string, prefix: string | undefined, fn: (cm: any, params: any) => void): void;
  };
  const session = (cm: any): Session | undefined => cm.state.vimtextSession;
  V.defineEx("write", "w", (cm) => session(cm)?.mirror.notify("VimText: nothing to write (the page owns saving)", 2500));
  V.defineEx("quit", "q", (cm) => session(cm)?.leave());
  V.defineEx("wq", undefined, (cm) => session(cm)?.leave());
  V.defineEx("xit", "x", (cm) => session(cm)?.leave());
}

/**
 * One activated Field: owns the mirror, routes keys by Mode, keeps the Field
 * and the mirror in sync, and renders the engine's cursor into the Field.
 */
export class Session {
  readonly mirror: Mirror;
  readonly status: StatusLine;
  private readonly stopInput: () => void;
  /** Set when the command that entered Insert also changed text (cw, o, s…): the typed text joins its undo step. */
  private joinNextInsert = false;
  private firstInsertSync = true;
  private destroyed = false;
  private syncing = false;
  private renderQueued = false;
  /** The Field selection we last wrote; anything else means the user moved the caret. */
  private lastRendered: { anchor: number; head: number } | null = null;

  constructor(readonly field: Field, config: SessionConfig) {
    defineExCommands();
    this.status = new StatusLine(field);
    const sel = field.getSelection();
    this.mirror = new Mirror({
      container: this.status.mirrorContainer,
      inputField: field.element,
      focus: () => field.focus(),
      doc: field.getValue(),
      cursor: sel.head,
      style: field.wrappingStyle(),
      statusbar: this.status.statusbar,
    });
    (this.mirror.cm.state as any).vimtextSession = this;
    this.mirror.cm.on("vim-mode-change", this.onModeChange);
    this.mirror.onUpdate((docChanged, selectionSet) => {
      // Ex commands typed into the command line (:s, :g, :sort, …) and the
      // engine's own async work change the mirror outside handleKeydown.
      if (!this.syncing && (docChanged || selectionSet)) this.scheduleRender();
    });
    this.stopInput = field.onInput(this.onFieldInput);
    this.runVimrc(config.vimrc);
    this.status.show();
    this.status.setMode(this.mode);
    this.render();
  }

  get mode(): string {
    return this.mirror.vim.mode ?? "normal";
  }

  private get nativeInsert(): boolean {
    return this.mirror.vim.insertMode && !this.mirror.cm.state.overwrite;
  }

  private runVimrc(vimrc: string): void {
    for (const raw of vimrc.split("\n")) {
      const line = raw.replace(/^\s*:?/, "").trim();
      if (!line || line.startsWith('"')) continue;
      try {
        this.mirror.handleEx(line);
      } catch (err) {
        console.warn("VimText vimrc:", line, err);
      }
    }
  }

  /** Called from the document-level capture listener for keys targeted at this Field. */
  handleKeydown(e: KeyboardEvent): void {
    if (this.destroyed || e.isComposing || e.key === "Process" || e.key === "Dead") return;
    const vim = this.mirror.vim;

    if (this.nativeInsert) {
      if (!isInsertModeVimKey(e)) return; // native typing
      this.syncFromField();
      this.dispatchToEngine(e);
      return;
    }

    // Engine-owned Modes. The Field is the truth if the page changed it behind our back.
    this.syncFromField();
    const pending = vim.inputState.keyBuffer.length > 0 || !!vim.inputState.operator;
    const plainNormal = !vim.insertMode && !vim.visualMode && !pending;

    if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) return; // focus navigation
    if (e.key === "Enter" && this.field.singleLine && plainNormal && !e.ctrlKey && !e.metaKey) return; // submit
    const esc = e.key === "Escape" || (e.ctrlKey && e.key === "[");
    if (esc && plainNormal) return; // let the page see a 2nd Esc

    this.dispatchToEngine(e);
    if (esc) {
      // The engine reports Esc in Normal as unhandled even when it cancelled a
      // pending operator or count; the page must not see that press.
      e.preventDefault();
      e.stopPropagation();
    }
  }

  private dispatchToEngine(e: KeyboardEvent): void {
    const before = this.mirror.view.state;
    const wasInsert = this.mirror.vim.insertMode;
    let handled = false;
    try {
      handled = this.mirror.handleKey(toEngineKey(e));
    } catch (err) {
      console.error("VimText engine error", err);
    }
    const after = this.mirror.view.state;
    if (!wasInsert && this.mirror.vim.insertMode) {
      this.joinNextInsert = after.doc !== before.doc;
      this.firstInsertSync = true;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    } else if (!this.nativeInsert && !e.ctrlKey && !e.metaKey && e.key.length === 1) {
      e.preventDefault(); // Vim beeps at unknown printable keys; the page never sees them
      e.stopPropagation();
    }
    this.render();
  }

  private onFieldInput = (): void => {
    if (this.destroyed) return;
    this.syncFromField();
  };

  private onModeChange = (): void => {
    if (this.destroyed) return;
    this.status.setMode(this.mode);
  };

  /**
   * Brings the mirror up to date with the Field. Text differences become one
   * change; in Insert mode that change is recorded by the engine for `.` and
   * joined into the current undo step.
   */
  private syncFromField(): void {
    // A render queued by a mirror update must land before we judge whether the
    // Field's selection is the user's doing.
    if (this.renderQueued) this.render();
    this.syncing = true;
    try {
      this.syncFromFieldInner();
    } finally {
      this.syncing = false;
    }
  }

  private syncFromFieldInner(): void {
    const view = this.mirror.view;
    const text = this.field.getValue();
    const doc = view.state.doc.toString();
    const sel = this.field.getSelection();
    const insert = this.mirror.vim.insertMode;

    if (text !== doc) {
      let start = 0;
      const max = Math.min(text.length, doc.length);
      while (start < max && text.charCodeAt(start) === doc.charCodeAt(start)) start++;
      let endT = text.length, endD = doc.length;
      while (endT > start && endD > start && text.charCodeAt(endT - 1) === doc.charCodeAt(endD - 1)) { endT--; endD--; }
      const head = Math.min(sel.head, text.length);
      let userEvent = "input.type";
      if (insert) {
        userEvent = this.firstInsertSync && !this.joinNextInsert ? "input.type.compose.start" : "input.type.compose";
        this.firstInsertSync = false;
      }
      const changes = view.state.changes({ from: start, to: endD, insert: text.slice(start, endT) });
      const newDoc = changes.apply(view.state.doc);
      view.dispatch({
        changes,
        selection: EditorSelection.cursor(insert ? head : clipToLine(newDoc, head)),
        userEvent,
      });
      return;
    }

    const main = view.state.selection.main;
    if (insert) {
      if (main.head !== sel.head || main.anchor !== sel.anchor) {
        view.dispatch({ selection: EditorSelection.cursor(Math.min(sel.head, text.length)) });
      }
      return;
    }
    const expected = this.lastRendered ?? this.renderedSelection();
    if (expected.anchor !== sel.anchor || expected.head !== sel.head) {
      // The user moved the caret or dragged a selection with the mouse.
      const range = sel.anchor === sel.head
        ? EditorSelection.cursor(clipToLine(view.state.doc, sel.head))
        : EditorSelection.range(sel.anchor, sel.head);
      view.dispatch({ selection: range });
    }
  }

  /** What the Field's selection should look like for the mirror's current state. */
  private renderedSelection(): { anchor: number; head: number } {
    const state = this.mirror.view.state;
    const main = state.selection.main;
    const vim = this.mirror.vim;
    if (vim.insertMode || vim.visualMode || !main.empty) return { anchor: main.anchor, head: main.head };
    const line = state.doc.lineAt(main.head);
    return main.head < line.to ? { anchor: main.head, head: main.head + 1 } : { anchor: main.head, head: main.head };
  }

  private scheduleRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    queueMicrotask(() => {
      if (this.renderQueued) this.render();
    });
  }

  /** Writes the engine's text and cursor into the Field. */
  render(): void {
    this.renderQueued = false;
    if (this.destroyed) return;
    const text = this.mirror.view.state.doc.toString();
    if (text !== this.field.getValue()) this.field.setValue(text);
    const sel = this.renderedSelection();
    this.field.setSelection(sel.anchor, sel.head);
    this.lastRendered = this.field.getSelection();
    this.status.setMode(this.mode);
    this.status.reposition();
  }

  onFocus(): void {
    if (this.destroyed) return;
    this.mirror.applyStyle(this.field.wrappingStyle());
    this.status.show();
    this.syncFromField();
    this.render();
  }

  onBlur(): void {
    if (this.destroyed) return;
    // Keep the bar while the command line has focus; it lives in our shadow root.
    if (this.status.dialogOpen()) return;
    this.status.hide();
  }

  /** `:q` — done editing here. */
  leave(): void {
    // The engine re-focuses the Field when its dialog closes; blur after that.
    queueMicrotask(() => {
      this.field.blur();
      this.status.hide();
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.mirror.cm.off("vim-mode-change", this.onModeChange);
    this.stopInput();
    this.mirror.destroy();
    this.status.destroy();
  }
}
