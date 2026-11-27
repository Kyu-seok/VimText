import type { ChangeSet } from "@codemirror/state";
import type { Field, FieldSelection, WrappingStyle } from "./Field";
import { diffText } from "./diff";
import { askMonaco } from "./monacoAdapter";
import type { MonacoEdit } from "./monacoProtocol";

/**
 * The Monaco Field (GLOSSARY.md; ADR 0010): one Monaco code editor, read and
 * written through VimText's page-world script. Its element is the input Monaco
 * focuses, which holds none of the code (docs/engine-seams.md, "Monaco's input
 * textarea"); its text is the editor's whole model text, with `\n` line ends.
 *
 * An answer that does not come, or is not one, leaves the Field at what it
 * last read: a write the editor did not take then reads as a refused edit.
 */
export class MonacoField implements Field {
  readonly singleLine = false;
  private text = "";
  private selection: FieldSelection = { anchor: 0, head: 0 };
  /** Whether the editor's cursor style is the block VimText set. */
  private block = false;

  constructor(readonly element: HTMLElement) {}

  /** Monaco's own element around the input: the editor as the person sees it. */
  private editor(): HTMLElement {
    return this.element.closest<HTMLElement>(".monaco-editor") ?? this.element;
  }

  boxElement(): HTMLElement {
    return this.editor();
  }

  getValue(): string {
    const answer = askMonaco(this.element, { op: "read" });
    if (answer?.text !== undefined) {
      this.text = answer.text;
      this.selection = { anchor: answer.anchor, head: answer.head };
    }
    return this.text;
  }

  /**
   * Writes the mirror's changes as edits, one step of Monaco's undo stack
   * (docs/engine-seams.md, "Monaco: undo stops"), never the whole text: a
   * whole-text write took about 100 ms at 50k lines (#113). Without the
   * changes, the one span that differs.
   */
  setValue(text: string, changes?: ChangeSet): void {
    const before = this.getValue();
    if (before === text) return;
    const edits: MonacoEdit[] = [];
    if (changes && changes.length === before.length) {
      changes.iterChanges((from, to, _fromNew, _toNew, inserted) =>
        edits.push({ from, to, insert: inserted.toString() }),
      );
    } else {
      const { start, endOld, endNew } = diffText(before, text);
      edits.push({ from: start, to: endOld, insert: text.slice(start, endNew) });
    }
    askMonaco(this.element, { op: "edit", edits });
  }

  getSelection(): FieldSelection {
    const answer = askMonaco(this.element, { op: "selection" });
    if (answer) this.selection = { anchor: answer.anchor, head: answer.head };
    return this.selection;
  }

  /** Always sent, a selection that is already there too: setting it is what drops Monaco's other cursors. */
  setSelection(anchor: number, head: number): void {
    askMonaco(this.element, { op: "select", anchor, head });
  }

  /**
   * Monaco's block cursor style for Normal, or the style the page had, which
   * the page-world script keeps. Asked only on a change: every render calls it.
   */
  showBlockCursor(on: boolean): void {
    if (on === this.block) return;
    this.block = on;
    askMonaco(this.element, { op: "cursor", block: on });
  }

  hasFocus(): boolean {
    return this.element.matches(":focus");
  }

  focus(): void {
    this.element.focus({ preventScroll: true });
  }

  blur(): void {
    this.element.blur();
  }

  visibleLineCount(): number {
    const editor = this.editor();
    const lineHeight = parseFloat(getComputedStyle(this.lines()).lineHeight) || 18;
    return Math.max(1, Math.floor(editor.clientHeight / lineHeight));
  }

  /** The element Monaco draws its lines in, which carries the code's font. */
  private lines(): HTMLElement {
    return this.editor().querySelector<HTMLElement>(".view-lines") ?? this.editor();
  }

  /**
   * Nothing yet: in Insert, Monaco's own edits reach the mirror when the next
   * Vim key reads the Field. Change notifications from the page world are #120.
   */
  onInput(): () => void {
    return () => {};
  }

  wrappingStyle(): WrappingStyle {
    const lines = this.lines();
    const cs = getComputedStyle(lines);
    return {
      font: cs.font,
      letterSpacing: cs.letterSpacing,
      lineHeight: cs.lineHeight,
      contentWidth: Math.max(0, lines.clientWidth),
      whiteSpace: "pre",
      wordBreak: "normal",
      overflowWrap: "normal",
      tabSize: cs.tabSize,
    };
  }

  isConnected(): boolean {
    return this.element.isConnected;
  }

  /** The Session ended: the editor gets the page's cursor style back. */
  destroy(): void {
    this.showBlockCursor(false);
  }
}
