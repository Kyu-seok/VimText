import type { Field } from "../field/Field";

/** What VimText draws for the Cursor: a block in Normal and operator-pending, a bar in Replace. */
export type CursorShape = "block" | "bar";

/** The bar's thickness along the character's bottom, in CSS px. */
const BAR_PX = 2;

/**
 * Hides the page's own caret while the Cursor is drawn (ADR 0009). Never while
 * a write runs: Chromium's editing commands carry the computed `caret-color`
 * of the text they move into the markup they write (docs/engine-seams.md,
 * "The caret-hiding stylesheet under editing").
 */
const CARET_HIDDEN = ":focus, :focus * { caret-color: transparent !important; }";

export const DRAWN_CURSOR_CSS = `
.cursor {
  position: fixed; z-index: 2147483646; pointer-events: none;
  background: #fff; mix-blend-mode: difference;
}
`;

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function intersect(a: Rect, b: Rect): Rect {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
}

/** An element's client area (inside its borders and scrollbars), in the viewport. */
function clientArea(el: Element): Rect {
  const r = el.getBoundingClientRect();
  const left = r.left + el.clientLeft;
  const top = r.top + el.clientTop;
  return { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight };
}

/**
 * The part of `el` the person can see: its client area, cut by every
 * ancestor that clips its overflow (an inner scroller, across shadow roots)
 * and by the viewport.
 */
function visiblePart(el: HTMLElement): Rect {
  const win = el.ownerDocument.defaultView!;
  let visible = intersect(clientArea(el), {
    left: 0,
    top: 0,
    right: win.innerWidth,
    bottom: win.innerHeight,
  });
  for (let a = parentOf(el); a; a = parentOf(a)) {
    if (a === el.ownerDocument.documentElement || a === el.ownerDocument.body) continue;
    const cs = getComputedStyle(a);
    if (cs.overflowX !== "visible" || cs.overflowY !== "visible") visible = intersect(visible, clientArea(a));
  }
  return visible;
}

function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/**
 * The Normal-mode Cursor VimText draws over a contenteditable Field (ADR 0009,
 * DESIGN.md "Cursor"), whose selection is then a collapsed caret: a steady
 * block over the Cursor's character, or a bar along its bottom in Replace,
 * inverting what is beneath and ignoring the mouse. It lives in the Field's
 * Status Line host. While drawn it is measured again on every scroll (capture
 * phase) and resize, on a resize of the Field and on mutations inside it (one
 * measurement per animation frame), and clipped to the Field's visible part;
 * the page's caret is hidden by a constructed stylesheet adopted by the
 * Field's document or shadow root, never by an attribute on the page's element.
 */
export class DrawnCursor {
  private readonly el: HTMLElement;
  private drawn: { shape: CursorShape; offset: number } | null = null;
  private frame = 0;
  private readonly resizes = new ResizeObserver(() => this.schedule());
  private readonly mutations = new MutationObserver(() => this.schedule());
  private readonly caretSheet = new CSSStyleSheet();
  /** The document or shadow root that adopted `caretSheet`, while it hides the caret. */
  private caretHiddenIn: Document | ShadowRoot | null = null;
  /** A write to the Field is running: the caret stays the page's until it has settled. */
  private writing = false;

  constructor(
    root: ShadowRoot,
    private readonly field: Field,
  ) {
    this.el = document.createElement("div");
    this.el.className = "cursor";
    this.el.style.display = "none";
    root.append(this.el);
    this.caretSheet.replaceSync(CARET_HIDDEN);
  }

  /**
   * Draws `shape` over the Cursor at `offset`, or nothing (`null`). Measured
   * now: a render lands the selection and the block in the same task.
   */
  draw(shape: CursorShape | null, offset: number): void {
    if (!shape || !this.field.cursorBox) return this.hide();
    if (!this.drawn) this.listen();
    this.drawn = { shape, offset };
    this.hideCaret();
    this.measure();
  }

  /**
   * A write to the Field starts (`true`) or has settled (`false`). While it
   * runs the page's caret is not hidden: Chromium's editing commands would
   * write the stylesheet's `caret-color` into the page's markup.
   */
  setWriting(writing: boolean): void {
    this.writing = writing;
    if (writing) this.showCaret();
    else if (this.drawn) this.hideCaret();
  }

  hide(): void {
    if (!this.drawn) return;
    this.drawn = null;
    this.el.style.display = "none";
    this.unlisten();
    this.showCaret();
  }

  destroy(): void {
    this.hide();
    this.el.remove();
  }

  private readonly schedule = (): void => {
    if (!this.drawn || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.measure();
    });
  };

  private listen(): void {
    window.addEventListener("scroll", this.schedule, { capture: true, passive: true });
    window.addEventListener("resize", this.schedule, { passive: true });
    this.resizes.observe(this.field.element);
    this.mutations.observe(this.field.element, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  }

  private unlisten(): void {
    window.removeEventListener("scroll", this.schedule, { capture: true });
    window.removeEventListener("resize", this.schedule);
    this.resizes.disconnect();
    this.mutations.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private measure(): void {
    const drawn = this.drawn;
    if (!drawn) return;
    const box = this.field.cursorBox?.(drawn.offset);
    if (!box) {
      this.el.style.display = "none";
      return;
    }
    const target: Rect =
      drawn.shape === "bar"
        ? { left: box.left, top: box.bottom - BAR_PX, right: box.right, bottom: box.bottom }
        : { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    const r = intersect(target, visiblePart(this.field.element));
    if (r.right <= r.left || r.bottom <= r.top) {
      this.el.style.display = "none";
      return;
    }
    const s = this.el.style;
    s.display = "";
    s.left = `${r.left}px`;
    s.top = `${r.top}px`;
    s.width = `${r.right - r.left}px`;
    s.height = `${r.bottom - r.top}px`;
    this.el.dataset.shape = drawn.shape;
  }

  private hideCaret(): void {
    if (this.caretHiddenIn || this.writing) return;
    const root = this.field.element.getRootNode();
    if (!(root instanceof Document || root instanceof ShadowRoot)) return;
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, this.caretSheet];
    this.caretHiddenIn = root;
  }

  private showCaret(): void {
    const root = this.caretHiddenIn;
    if (!root) return;
    this.caretHiddenIn = null;
    root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== this.caretSheet);
  }
}
