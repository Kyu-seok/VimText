import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history } from "@codemirror/commands";
import { vim, getCM, Vim } from "@replit/codemirror-vim";
import type { WrappingStyle } from "../field/Field";
import { modeFromEngine, type Mode } from "./mode";

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

/**
 * A hidden CodeMirror 6 view running the Vim engine. The bridge feeds it keys
 * and reads its document/selection back; it is never shown to the user.
 */
export class Mirror {
  readonly view: EditorView;
  readonly cm: VimCM;
  readonly plugin: VimPlugin;
  private updateHandlers = new Set<(docChanged: boolean, selectionSet: boolean) => void>();

  constructor(opts: MirrorOptions) {
    const updateListener: Extension = EditorView.updateListener.of((u) => {
      for (const h of this.updateHandlers) h(u.docChanged, u.selectionSet);
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

    cm.state.statusbar = opts.statusbar;
    this.plugin.updateStatus();
    this.applyStyle(opts.style);
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
  }

  onUpdate(handler: (docChanged: boolean, selectionSet: boolean) => void): () => void {
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
