import { EditorSelection, type Text } from "@codemirror/state";
import type { Field } from "../field/Field";
import { diffText } from "../field/diff";
import { Mirror, Vim, type KeyLike } from "../engine/mirror";
import { engineApi } from "../engine/pluginApi";
import { vimrcLines } from "../engine/vimrc";
import type { Mode } from "../engine/mode";
import type { Plugin, PluginContext } from "../plugins/Plugin";
import { StatusLine } from "../ui/StatusLine";
import { PluginKeyHook } from "./PluginKeyHook";

interface SessionConfig {
  vimrc: string;
  /** The enabled Plugins: bound on every Activation, before the vimrc, so a vimrc mapping wins. */
  plugins?: Plugin[];
  /**
   * The engine opened or closed its dialog. The command line commits its
   * history as it closes, inside its own input's keydown listener in the
   * Status Line, after the keydown has passed the document: a Session State
   * snapshot taken from the document's listener misses it, one taken here does not.
   */
  onDialog?: () => void;
}

/** `Esc` or its Vim twin `Ctrl+[`. */
function isEscape(e: KeyboardEvent): boolean {
  return e.key === "Escape" || (e.ctrlKey && !e.metaKey && !e.altKey && e.key === "[");
}

/** Keys VimText takes from the Field while in Insert mode. Everything else is native. */
function isInsertModeVimKey(e: KeyboardEvent): boolean {
  if (isEscape(e)) return true;
  if (!e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key === "o" || e.key === "r" || e.key === "u" || e.key === "w";
}

/** A key that would type a character if the page saw it. */
function isUnmodifiedPrintable(e: KeyboardEvent): boolean {
  return !e.ctrlKey && !e.metaKey && e.key.length === 1;
}

/** The browser's own undo/redo. Outside Insert the engine's history is the only one. */
function isNativeHistoryKey(e: KeyboardEvent): boolean {
  if (e.altKey || !(e.ctrlKey || e.metaKey)) return false;
  const k = e.key.toLowerCase();
  return k === "z" || (e.ctrlKey && k === "y");
}

/** The key that Activates VimText on a Field with Site Policy "insert". */
export function isActivationKey(e: KeyboardEvent): boolean {
  return isEscape(e);
}

/** The adapter maps <C-[> to <Esc> itself, but normalising here keeps the policy checks simple. */
function toEngineKey(e: KeyboardEvent): KeyLike {
  const esc = isEscape(e);
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

/**
 * A key the bridge feeds on its own: a released held key, or a Plugin Key by
 * name (`SurroundDs`; the engine brackets any multi-character name). Never
 * shifted: a shifted multi-character name would become `<S-SurroundS>`.
 */
function syntheticKey(key: string): KeyLike {
  return {
    key,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault: () => {},
    stopPropagation: () => {},
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
  const write = (cm: any) =>
    session(cm)?.mirror.notify("VimText: nothing to write (the page owns saving)", 2500);
  const writeQuit = (cm: any) => {
    write(cm);
    session(cm)?.leave();
  };
  V.defineEx("write", "w", write);
  V.defineEx("quit", "q", (cm) => session(cm)?.leave());
  V.defineEx("wq", undefined, writeQuit);
  V.defineEx("xit", "x", writeQuit);
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
  /** Set when the queued render carries a text change; cleared when the render lands or drops it. */
  private queuedDocChange = false;
  /** Set by `:wq`/`:x`: the Status Line shows the `:w` notice after the Field blurs. */
  private noticeOutlivesBlur = false;
  /** The Field selection we last wrote; anything else means the user moved the caret. */
  private lastRendered: { anchor: number; head: number } | null = null;
  /** The Field text the bridge last wrote or agreed with; anything else means the page changed the Field. */
  private lastText: string | null = null;
  private readonly onDialog: (() => void) | undefined;
  /** The Plugin key hook: turns the typed sequences the enabled Plugins claim into Plugin Keys. */
  private readonly pluginKeys: PluginKeyHook;

  constructor(
    readonly field: Field,
    config: SessionConfig,
  ) {
    defineExCommands();
    this.onDialog = config.onDialog;
    this.pluginKeys = new PluginKeyHook((config.plugins ?? []).flatMap((p) => p.keys));
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
    this.mirror.cm.on("dialog", this.onDialogChange);
    this.mirror.onUpdate((docChanged, selectionSet) => {
      // Ex commands typed into the command line (:s, :g, :sort, …) and the
      // engine's own async work change the mirror outside handleKeydown.
      if (this.syncing || !(docChanged || selectionSet)) return;
      if (docChanged) this.queuedDocChange = true;
      this.scheduleRender();
    });
    this.stopInput = field.onInput(this.onFieldInput);
    this.runVimrc(config);
    this.status.show();
    this.status.setMode(this.mode);
    this.render();
  }

  /** The engine has no Command-line mode of its own: it is the `:` `/` `?` input being open. */
  get mode(): Mode {
    return this.mirror.commandLineOpen() ? "command-line" : this.mirror.mode;
  }

  private get nativeInsert(): boolean {
    return this.mirror.vim.insertMode && !this.mirror.cm.state.overwrite;
  }

  /**
   * The saved vimrc is the whole truth about user mappings: engine mappings
   * are global per frame and would otherwise outlive their vimrc line until
   * the tab reloads (see the mapping seam in docs/engine-seams.md). The clear
   * wipes the enabled Plugins' bindings too, so they bind again first, and
   * the vimrc runs last so that a vimrc mapping on a key a Plugin also binds
   * wins (DESIGN.md "Settings", ADR 0006). Errors are not reported here; the
   * options page runs the same lines on save.
   */
  private runVimrc(config: SessionConfig): void {
    this.mirror.clearUserMappings();
    for (const plugin of config.plugins ?? []) {
      plugin.define(engineApi);
      plugin.bind(engineApi);
    }
    for (const { text } of vimrcLines(config.vimrc)) {
      try {
        this.mirror.handleEx(text);
      } catch {
        // Reported by the options page on save.
      }
    }
  }

  /** Called from the document-level capture listener for keys targeted at this Field. */
  handleKeydown(e: KeyboardEvent): void {
    if (this.destroyed || e.isComposing || e.key === "Process" || e.key === "Dead") return;
    const vim = this.mirror.vim;

    if (this.nativeInsert) {
      // A whitelisted key may leave the engine waiting for more (<C-r> wants a
      // register); the keys that complete it are the engine's too.
      const pendingInsert = vim.inputState.keyBuffer.length > 0;
      if (!pendingInsert && !isInsertModeVimKey(e)) return; // native typing
      this.syncFromField();
      this.dispatchToEngine(e);
      return;
    }

    // Engine-owned Modes. The Field is the truth if the page changed it behind our back.
    this.syncFromField();
    const policy = this.keyPolicy(e);
    if (policy === "pass-through") return;
    if (policy === "beep") {
      this.beep();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (this.applyPluginKeys(e) === "consumed") {
      e.preventDefault();
      e.stopPropagation();
      this.render();
      return;
    }

    if (this.mirror.vim.inputState.registerName === "+" && !navigator.clipboard) {
      // A plain http page has no clipboard API at all (DESIGN.md "Accepted
      // limitations"): the engine's `"+` yank would throw inside its register
      // write, so the command is a beep with a reason instead.
      this.beep();
      this.mirror.notify("VimText: no clipboard on this page (not a secure context)");
      e.preventDefault();
      e.stopPropagation();
      this.render();
      return;
    }
    if (this.isClipboardPaste(e)) {
      this.pasteFromClipboard(e);
      return;
    }

    this.dispatchToEngine(e);
    if (isEscape(e)) {
      // The engine reports Esc in Normal as unhandled even when it cancelled a
      // pending operator or count; the page must not see that press.
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /** `p` or `P` with the clipboard register selected (`"+` or its alias `"*`). */
  private isClipboardPaste(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey || (e.key !== "p" && e.key !== "P")) return false;
    return this.mirror.vim.inputState.registerName === "+";
  }

  /**
   * The engine's `"+p` reads the clipboard asynchronously and never catches a
   * rejected read (a cross-origin frame whose embedding page's permissions
   * policy denies clipboard access; DESIGN.md "Accepted limitations"), so the
   * bridge reads first: on success the key goes to the engine, whose own read
   * then succeeds; on failure the pending register is dropped as a beep and
   * the Status Line says why. The paste was already asynchronous in the
   * engine, so a key typed before the read resolves still lands first.
   */
  private pasteFromClipboard(e: KeyboardEvent): void {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.readText().then(
      () => {
        if (this.destroyed) return;
        this.syncFromField();
        this.dispatchToEngine(e);
      },
      () => {
        if (this.destroyed) return;
        this.beep();
        this.mirror.notify("VimText: the clipboard cannot be read here");
        this.render();
      },
    );
  }

  /**
   * The Key Policy rows decided before the engine sees a key (DESIGN.md "Key
   * Policy" rows 4–7); a vimrc mapping never reaches them. Everything else is
   * the engine's call.
   */
  private keyPolicy(e: KeyboardEvent): "engine" | "pass-through" | "beep" {
    const vim = this.mirror.vim;
    const buffered = vim.inputState.keyBuffer.join(""); // a count ("3") or a partial key ("g", '"')
    const operatorPending = !!vim.inputState.operator;
    // A key the Plugin key hook holds is pending input too: the Esc that discards it is ours.
    const pending = buffered.length > 0 || operatorPending || this.pluginKeys.holding;
    const normal = !vim.insertMode && !vim.visualMode;
    const plainNormal = normal && !pending;
    const unmodified = !e.ctrlKey && !e.metaKey && !e.altKey;

    if (e.key === "Tab" && unmodified) return "pass-through"; // row 4: focus navigation
    if (isEscape(e) && plainNormal) return "pass-through"; // row 5: let the page see a 2nd Esc
    if (this.field.singleLine) {
      if (e.key === "Enter" && plainNormal && !e.ctrlKey && !e.metaKey) return "pass-through"; // row 6: submit
      // Row 7: no line to open; a count or register prefix ("a, kept by the
      // engine outside keyBuffer) is dropped with it. Visual o/O (other end)
      // and a pending operator or partial key (do, go) are the engine's.
      const onlyCountPending = !operatorPending && /^\d*$/.test(buffered);
      if ((e.key === "o" || e.key === "O") && unmodified && normal && onlyCountPending) return "beep";
    }
    return "engine";
  }

  /** Vim's beep: the pending count is dropped and the Status Line's pending keys clear. */
  private beep(): void {
    this.mirror.handleKey(toEngineKey(new KeyboardEvent("keydown", { key: "Escape" })));
  }

  /**
   * The engine's context as the Plugin key hook sees it (DESIGN.md "Plugins"):
   * null when a partial key (`g`, `"`, `z`) is pending, which no Plugin claims.
   * A count in the buffer or a register already taken is fine.
   */
  private pluginContext(): PluginContext | null {
    const vim = this.mirror.vim;
    if (vim.visualMode) return "visual";
    if (vim.inputState.operator) return "operator-pending";
    return /^\d*$/.test(vim.inputState.keyBuffer.join("")) ? "normal" : null;
  }

  /**
   * The Plugin key hook (Key Policy row 1; DESIGN.md "Plugins", ADR 0006): a
   * typed sequence an enabled Plugin claims reaches the engine as one Plugin
   * Key, keys held for a sequence that does not complete are released in
   * order, Esc discards them and goes on to the engine as pending input.
   * Released keys and Plugin Keys go through the mirror directly so macro
   * recording sees them; "consumed" means this key is now spent.
   */
  private applyPluginKeys(e: KeyboardEvent): "consumed" | "continue" {
    const hook = this.pluginKeys;
    if (isEscape(e)) {
      hook.discard();
      return "continue";
    }
    const typed = !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 ? e.key : null;
    // A Plugin Key changes the context for the key after it (`ys` followed by a
    // targets sequence), so that key is looked at again in the new context.
    for (;;) {
      const step = hook.step(this.pluginContext(), typed);
      switch (step.kind) {
        case "pass":
          return "continue";
        case "hold":
          return "consumed";
        case "release":
          for (const key of step.held) this.mirror.handleKey(syntheticKey(key));
          return "continue";
        case "plugin-key":
          this.mirror.handleKey(syntheticKey(step.key));
          this.mirror.showTypedKeys(`<${step.key}>`, step.typed);
          if (step.consumed) return "consumed";
      }
    }
  }

  /**
   * True while the engine waits for a register name: after `"` in Normal or
   * Visual (a count may precede it), after `Ctrl-r` in Insert.
   */
  private awaitingRegister(): boolean {
    const buffer = this.mirror.vim.inputState.keyBuffer;
    const last = buffer[buffer.length - 1];
    return last === '"' || last === "<C-r>";
  }

  /**
   * The key the engine gets. `"*` is an alias of `"+` (DESIGN.md "Registers &
   * clipboard"): the engine knows only `+` as the clipboard register, so the
   * bridge rewrites the register name before the engine sees it. Not an engine
   * change (rule 3): the clipboard behaviour stays the engine's.
   */
  private engineKey(e: KeyboardEvent): KeyLike {
    const key = toEngineKey(e);
    if (key.key === "*" && !e.ctrlKey && !e.metaKey && !e.altKey && this.awaitingRegister()) key.key = "+";
    return key;
  }

  private dispatchToEngine(e: KeyboardEvent): void {
    const before = this.mirror.view.state;
    const wasInsert = this.mirror.vim.insertMode;
    let handled = false;
    try {
      handled = this.mirror.handleKey(this.engineKey(e));
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
    } else if (!this.nativeInsert && (isNativeHistoryKey(e) || isUnmodifiedPrintable(e))) {
      e.preventDefault(); // Vim beeps at unknown printable keys; the page never sees them
      e.stopPropagation();
    } else if (!this.mirror.vim.insertMode && e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      // Normal/Visual only: Vim beeps at a motion that fails (d<CR> on the last
      // line), so a half-typed command never submits a form or puts a newline
      // in a textarea. In Replace mode Enter breaks the line, as Vim's does.
      e.preventDefault();
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

  /** After `:wq`, the `:w` notice outlives the Field's focus; the bar hides once it closes. */
  private onDialogChange = (): void => {
    if (this.destroyed) return;
    this.onDialog?.();
    if (!this.noticeOutlivesBlur || this.mirror.dialog) return;
    this.noticeOutlivesBlur = false;
    if (!this.field.hasFocus()) this.status.hide();
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
    this.withSyncing(() => this.syncFromFieldInner());
  }

  /** Runs our own mirror dispatches, whose updates must not queue a render: the caller renders. */
  private withSyncing(fn: () => void): void {
    this.syncing = true;
    try {
      fn();
    } finally {
      this.syncing = false;
    }
  }

  /**
   * @param provoked The Field's text is the page's answer to the change the
   *   mirror just made (a Controlled Field's rewrite): it joins that change's
   *   undo step, or `u` would undo the rewrite, the page would rewrite again,
   *   and undo would never move.
   */
  private syncFromFieldInner(provoked = false): void {
    const view = this.mirror.view;
    const text = this.field.getValue();
    const doc = view.state.doc.toString();
    const sel = this.field.getSelection();
    const insert = this.mirror.vim.insertMode;
    this.lastText = text;

    if (text !== doc) {
      const { start, endOld, endNew } = diffText(doc, text);
      const head = Math.min(sel.head, text.length);
      let userEvent = provoked ? "input.type.compose" : "input.type";
      if (insert) {
        // A provoked rewrite joins the engine change that provoked it (a Ctrl-r
        // paste) even here; the rest of the Insert session then keeps joining.
        const opensStep = this.firstInsertSync && !this.joinNextInsert && !provoked;
        userEvent = opensStep ? "input.type.compose.start" : "input.type.compose";
        this.firstInsertSync = false;
      }
      const changes = view.state.changes({ from: start, to: endOld, insert: text.slice(start, endNew) });
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
      const range =
        sel.anchor === sel.head
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
    return main.head < line.to
      ? { anchor: main.head, head: main.head + 1 }
      : { anchor: main.head, head: main.head };
  }

  private scheduleRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    queueMicrotask(() => {
      if (this.renderQueued) this.render();
    });
  }

  /**
   * The mirror of a Single-line Field never holds a newline. An engine dispatch
   * that left one (linewise `p`, `:put`, `Ctrl-r` with a multi-line register,
   * `:s/x/\r/`) is stripped as the input's own value sanitization would, in a
   * change joined to that command's undo step (userEvent `input.type.compose`,
   * see the undo-grouping seam in docs/engine-seams.md). Not an engine mapping:
   * those are global across every mirror.
   */
  private enforceSingleLine(): void {
    if (!this.field.singleLine) return;
    const view = this.mirror.view;
    const doc = view.state.doc;
    if (doc.lines === 1) return;
    const changes = view.state.changes(
      Array.from({ length: doc.lines - 1 }, (_, i) => {
        const to = doc.line(i + 1).to;
        return { from: to, to: to + 1 };
      }),
    );
    this.withSyncing(() => view.dispatch({ changes, userEvent: "input.type.compose" }));
  }

  /** Writes the engine's text and cursor into the Field. */
  render(): void {
    this.renderQueued = false;
    if (this.destroyed) return;
    if (this.lastText !== null && this.field.getValue() !== this.lastText) {
      // The page changed the Field since we last agreed with it (rule 1): the
      // Field wins, and the engine's change we were about to write is dropped,
      // folded into the Field's text so `u` never brings it back.
      this.withSyncing(() => this.syncFromFieldInner(this.queuedDocChange));
    }
    this.queuedDocChange = false;
    this.enforceSingleLine();
    const text = this.mirror.view.state.doc.toString();
    if (text !== this.field.getValue()) {
      this.field.setValue(text);
      // A Controlled Field rewrote the text inside the write; the Field is the truth.
      if (this.field.getValue() !== text) this.withSyncing(() => this.syncFromFieldInner(true));
    }
    const sel = this.renderedSelection();
    this.field.setSelection(sel.anchor, sel.head);
    this.lastRendered = this.field.getSelection();
    this.lastText = this.field.getValue();
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
    // Keep the bar while the command line has focus (it lives in our shadow
    // root) or `:wq` is leaving behind its notice.
    if (this.mirror.commandLineOpen() || this.noticeOutlivesBlur) return;
    this.status.hide();
  }

  /** `:q` — done editing here. */
  leave(): void {
    // The engine re-focuses the Field when its dialog closes; blur after that.
    queueMicrotask(() => {
      this.noticeOutlivesBlur = !!this.mirror.dialog;
      this.field.blur();
      if (!this.noticeOutlivesBlur) this.status.hide();
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.mirror.cm.off("vim-mode-change", this.onModeChange);
    this.mirror.cm.off("dialog", this.onDialogChange);
    this.stopInput();
    this.mirror.destroy();
    this.status.destroy();
  }
}
