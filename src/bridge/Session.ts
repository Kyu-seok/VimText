import { ChangeSet, EditorSelection, type Text } from "@codemirror/state";
import type { Field } from "../field/Field";
import { diffText } from "../field/diff";
import { ATOM_CHAR } from "../field/atoms";
import { clipToLine, Mirror, Vim, type KeyLike } from "../engine/mirror";
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
function fedKey(key: string): KeyLike {
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

/**
 * Whether a write of `text` that left the Field at `before` fell short only by
 * U+FFFC the Field had no element for (an undo of a literal U+FFFC, or of an
 * Atom it no longer keeps): the Field wrote what it could, which is not the
 * page refusing the edit, so it is folded like a Controlled Field's rewrite.
 */
function onlyAtomsUnwritten(before: string, text: string): boolean {
  const count = (s: string) => s.split(ATOM_CHAR).length - 1;
  return count(text) > count(before) && text.split(ATOM_CHAR).join("") === before.split(ATOM_CHAR).join("");
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
  /** The mirror's undo depth when `lastText` was last agreed: a refused edit undoes back to it. */
  private agreedDepth = 0;
  /**
   * A contenteditable write in flight (ADR 0008), until it has settled and
   * been judged. The Field is VimText's own until then: it is not read back.
   */
  private pendingWrite: Promise<void> | null = null;
  /** A render came due while a write was pending: it runs, merged, once that write settles. */
  private renderDue = false;
  private readonly onDialog: (() => void) | undefined;
  /** The enabled Plugins, bound on every Activation and told when the Field loses focus. */
  private readonly plugins: readonly Plugin[];
  /** The Plugin key hook: turns the typed sequences the enabled Plugins claim into Plugin Keys. */
  private readonly pluginKeys: PluginKeyHook;

  constructor(
    readonly field: Field,
    config: SessionConfig,
  ) {
    defineExCommands();
    this.onDialog = config.onDialog;
    this.plugins = config.plugins ?? [];
    this.pluginKeys = new PluginKeyHook(this.plugins.flatMap((p) => p.keys));
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
    for (const plugin of this.plugins) {
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
      if (!pendingInsert && !isInsertModeVimKey(e)) {
        if (this.pendingWrite || this.field.selectionSettling?.()) this.typeWhileWriting(e);
        return; // native typing
      }
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
   * null in Insert and Replace (`insertMode` with overwrite), where every typed
   * character is text, and null when a partial key (`g`, `"`, `z`, an
   * operator's `f`) is pending, which no Plugin claims: the key that completes
   * it is the engine's. A count in the buffer or a register already taken is fine.
   */
  private pluginContext(): PluginContext | null {
    const vim = this.mirror.vim;
    if (vim.insertMode) return null;
    if (!/^\d*$/.test(vim.inputState.keyBuffer.join(""))) return null;
    if (vim.visualMode) return "visual";
    return vim.inputState.operator ? "operator-pending" : "normal";
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
    // Keys fed to the engine change the context for the key after them: a
    // released `c` leaves an operator pending for the `i` that released it, a
    // Plugin Key (`ys`) may be followed by a targets sequence. So the key is
    // looked at again in the new context; with nothing held any more, the
    // second look can only hold it, pass it or complete a Plugin Key with it.
    for (;;) {
      const step = hook.step(this.pluginContext(), typed);
      switch (step.kind) {
        case "pass":
          return "continue";
        case "hold":
          return "consumed";
        case "release":
          for (const key of step.held) this.mirror.handleKey(fedKey(key));
          break;
        case "plugin-key":
          this.mirror.handleKey(fedKey(step.key));
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

  /**
   * A key typed in Insert while a write is pending (ADR 0008): the Field's
   * caret is not yet where the engine's cursor is (the `o` that entered Insert
   * has not landed), so typed natively it would go in the wrong place. So
   * too while the caret VimText set is settling (`Field.selectionSettling`):
   * the page's editor may not have taken it yet, and typed natively the key
   * would land at the editor's stale selection (#64). A
   * character, Backspace and a multi-line Field's Enter are typed into the
   * mirror instead, as the Field's own typing would sync into it, and land
   * with the merged render. Any other key stays the page's.
   */
  private typeWhileWriting(e: KeyboardEvent): void {
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    let insert: string;
    if (plain && e.key.length === 1) insert = e.key;
    else if (plain && e.key === "Enter" && !this.field.singleLine) insert = "\n";
    else if (plain && e.key === "Backspace") insert = "";
    else return;
    e.preventDefault();
    e.stopPropagation();
    const view = this.mirror.view;
    const main = view.state.selection.main;
    const from = main.empty && !insert ? Math.max(0, main.from - 1) : main.from;
    const opensStep = this.firstInsertSync && !this.joinNextInsert;
    this.firstInsertSync = false;
    view.dispatch({
      changes: { from, to: main.to, insert },
      selection: EditorSelection.cursor(from + insert.length),
      userEvent: opensStep ? "input.type.compose.start" : "input.type.compose",
    });
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
    // Mid-write the Field holds part of VimText's own write, not the page's
    // change: the keys go to the engine as they are, and the Field is read
    // once the write settles (`writeSettled`).
    if (this.pendingWrite) return;
    this.withSyncing(() => this.syncFromFieldInner());
    this.readAtoms();
  }

  /** The mirror's text is the Field's now: give it the Field's Atoms for the register writes. */
  private readAtoms(): void {
    if (!this.field.atoms) return;
    // Keys pressed during a write made the mirror's text newer than the
    // Field's: the Field's offsets do not fit it. The merged render reads them.
    if (this.field.getValue() !== this.mirror.view.state.doc.toString()) return;
    this.withSyncing(() => this.mirror.setAtoms(this.field.atoms!()));
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
      this.agreedDepth = this.mirror.undoDepth();
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

  /**
   * Writes the engine's text and cursor into the Field. While a write is
   * pending, the render waits: every render due meanwhile merges into one
   * write of the mirror's text once it has settled (ADR 0008).
   */
  render(): void {
    this.renderQueued = false;
    if (this.destroyed) return;
    if (this.pendingWrite) {
      this.renderDue = true;
      return;
    }
    if (this.lastText !== null && this.field.getValue() !== this.lastText) {
      // The page changed the Field since we last agreed with it (rule 1): the
      // Field wins, and the engine's change we were about to write is dropped,
      // folded into the Field's text so `u` never brings it back.
      this.withSyncing(() => this.syncFromFieldInner(this.queuedDocChange));
    }
    this.queuedDocChange = false;
    this.enforceSingleLine();
    const text = this.mirror.view.state.doc.toString();
    const before = this.field.getValue();
    if (text !== before) {
      const depth = this.mirror.undoDepth();
      const write = this.field.setValue(text);
      if (write) {
        const settled = () => this.writeSettled(before, text, depth);
        this.pendingWrite = write.then(settled, (err: unknown) => {
          console.error("VimText write error", err);
          settled();
        });
        return;
      }
      this.judgeWrite(before, text);
    }
    this.finishRender(this.mirror.undoDepth());
  }

  /**
   * The asynchronous write of `text` over `before` has settled: it is judged
   * now, against the Field as it stands, and the render that came due
   * meanwhile writes what the keys pressed since made of the mirror. A Session
   * destroyed meanwhile judges nothing. `depth` is the mirror's undo depth
   * the written text stood for.
   */
  private writeSettled(before: string, text: string, depth: number): void {
    this.pendingWrite = null;
    if (this.destroyed) return;
    const after = this.field.getValue();
    this.judgeWrite(before, text);
    // Accepted as written: `text` is the agreed text, at the depth it was
    // written from; the keys pressed since are the merged render's change.
    this.finishRender(after === text ? depth : this.mirror.undoDepth());
    if (this.renderDue) {
      this.renderDue = false;
      this.render();
    }
  }

  /**
   * Reads the Field after a write of `text` over `before`. A Field left at
   * `before` refused the write; one at anything else but `text` is a
   * Controlled Field's rewrite. Either way the Field wins. A refusal takes
   * back the changes of the keys pressed during an asynchronous write too
   * (they were made on an edit the page did not keep), and the Status Line
   * says so; a rewrite is applied under them instead (`rebaseOnField`).
   */
  private judgeWrite(before: string, text: string): void {
    const after = this.field.getValue();
    if (after === before && !onlyAtomsUnwritten(before, text)) this.dropRefusedChange(before);
    // A Controlled Field rewrote the text inside the write; the Field is the truth.
    else if (after !== text) {
      if (this.mirror.view.state.doc.toString() === text)
        this.withSyncing(() => this.syncFromFieldInner(true));
      else this.withSyncing(() => this.rebaseOnField(text, after));
    }
  }

  /**
   * The page made `text`, the write that settled, into `after`, while keys
   * pressed meanwhile made the mirror into something else again. The page's
   * change is mapped through the keys' and applied on top, so both stand (the
   * page's where they overlap, rule 1). It joins the mirror's latest undo
   * step, the keys' change, not the write that provoked it: that step is no
   * longer the latest. The merged render then writes the keys' change.
   */
  private rebaseOnField(text: string, after: string): void {
    const view = this.mirror.view;
    const now = view.state.doc.toString();
    const changeOf = (to: string) => {
      const d = diffText(text, to);
      return ChangeSet.of({ from: d.start, to: d.endOld, insert: to.slice(d.start, d.endNew) }, text.length);
    };
    view.dispatch({ changes: changeOf(after).map(changeOf(now)), userEvent: "input.type.compose" });
  }

  /**
   * Lands the engine's cursor and records what the Field and the mirror now
   * agree on, at undo depth `depth`. With a merged render due, the cursor is
   * left to it: the mirror's cursor is where the keys pressed during the write
   * put it, in text the Field does not hold yet, and an editor that takes the
   * selection into its model (Lexical) would apply the merged write there.
   */
  private finishRender(depth: number): void {
    const sel = this.renderedSelection();
    if (!this.renderDue) this.field.setSelection(sel.anchor, sel.head);
    this.lastRendered = this.field.getSelection();
    this.lastText = this.field.getValue();
    this.readAtoms();
    this.agreedDepth = depth;
    this.status.setMode(this.mode);
    this.status.reposition();
  }

  /**
   * Resolves once no write to the Field is pending and no render waits on
   * one: what the keys pressed so far made of the text is in the Field.
   */
  async settled(): Promise<void> {
    await Promise.resolve(); // a render queued for a microtask has started its write
    while (this.pendingWrite) {
      await this.pendingWrite;
      await Promise.resolve();
    }
  }

  /**
   * The page refused the write: the Field's text is what it was before it
   * (spec #40 "Writes"). The Field wins and the engine's change is taken back
   * out of the undo history, so `u` never undoes a change that never happened;
   * the part of a joined step the Field did keep is written back as a step of
   * its own, the cursor left where the command put it. In Insert and Replace
   * the change is folded instead, as a Controlled Field's rewrite is: an undo
   * there would be recorded as typed text for `.`, and the Insert session is
   * one undo step anyway. The Status Line says so: a refused `x` is never a
   * silent no-op.
   */
  private dropRefusedChange(before: string): void {
    const kept = this.mirror.vim.insertMode ? this.typedWithoutBreaks(before) : null;
    this.withSyncing(() => {
      if (this.mirror.vim.insertMode) {
        this.syncFromFieldInner(true);
        return;
      }
      this.mirror.takeBackSince(this.agreedDepth, this.field.getValue());
    });
    // The person's typing outlives a refused line break (#68): a page that
    // refuses a synthetic paragraph break (Notion, Slack) takes plain text, so
    // what was typed is written again without the break, on the line.
    if (kept) {
      const d = diffText(before, kept.text);
      this.mirror.view.dispatch({
        changes: { from: d.start, to: d.endOld, insert: kept.text.slice(d.start, d.endNew) },
        selection: EditorSelection.cursor(kept.cursor),
        userEvent: "input.type.compose",
      });
    }
    this.mirror.notify("VimText: the page refused the edit");
  }

  /**
   * What the mirror's Insert typing over `before` leaves without its line
   * breaks, and where the cursor goes; null when the typing held no break or
   * nothing is left. A refused write that held no break is refused whole.
   */
  private typedWithoutBreaks(before: string): { text: string; cursor: number } | null {
    const now = this.mirror.view.state.doc.toString();
    const d = diffText(before, now);
    const inserted = now.slice(d.start, d.endNew);
    if (!inserted.includes("\n")) return null;
    const flat = inserted.replace(/\n/g, "");
    const text = before.slice(0, d.start) + flat + before.slice(d.endOld);
    return text === before ? null : { text, cursor: d.start + flat.length };
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
    // Focus leaving ends what the Plugin key hook holds and any wait a Plugin
    // armed (DESIGN.md "Plugins"): a key typed back here or in another Field
    // starts afresh. A Pass-through key that keeps focus (Cmd+C) leaves both
    // alone, like a pending operator.
    this.pluginKeys.discard();
    for (const plugin of this.plugins) plugin.onBlur?.();
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
