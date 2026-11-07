import type { Field } from "../field/Field";

const CSS = `
:host { all: initial; }
.host { position: fixed; z-index: 2147483647; pointer-events: none; }
.bar {
  pointer-events: auto;
  display: flex; align-items: center; gap: 8px;
  box-sizing: border-box; min-height: 22px; padding: 2px 8px;
  font: 12px/1.4 ui-monospace, Menlo, Consolas, monospace;
  color: #e6e6e6; background: #1f2430; border-radius: 0 0 4px 4px;
  box-shadow: 0 2px 6px rgba(0,0,0,.25);
}
.bar.insert { opacity: .55; }
.bar span { white-space: pre; }
.bar > div { display: flex; align-items: center; gap: 6px; flex: 1; }
.bar input {
  all: unset; flex: 1; min-width: 0; color: inherit; font: inherit;
  caret-color: #e6e6e6;
}
.mirror {
  position: fixed; left: -100000px; top: 0; visibility: hidden; pointer-events: none;
  overflow: hidden;
}
.mirror .cm-editor { outline: none; }
`;

/**
 * The strip VimText shows at the bottom edge of an activated Field: mode,
 * pending keys, recording indicator, the command line for : / ?, and messages.
 * The engine owns the content of `statusbar`; this class owns placement and
 * also hosts the hidden mirror in the same shadow root.
 */
export class StatusLine {
  readonly host: HTMLElement;
  readonly statusbar: HTMLElement;
  readonly mirrorContainer: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly root: ShadowRoot;
  private visible = false;

  constructor(private readonly field: Field) {
    this.host = document.createElement("vimtext-status");
    this.root = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    const wrap = document.createElement("div");
    wrap.className = "host";
    this.bar = document.createElement("div");
    this.bar.className = "bar";
    this.statusbar = document.createElement("div");
    this.bar.appendChild(this.statusbar);
    wrap.appendChild(this.bar);
    this.mirrorContainer = document.createElement("div");
    this.mirrorContainer.className = "mirror";
    this.root.append(style, wrap, this.mirrorContainer);

    // Keystrokes typed into the command line must not reach the page's own
    // shortcut handlers.
    for (const type of ["keydown", "keypress", "keyup"]) {
      this.host.addEventListener(type, (e) => e.stopPropagation());
    }
    (document.documentElement ?? document.body).appendChild(this.host);
    this.hide();
    window.addEventListener("scroll", this.reposition, { capture: true, passive: true });
    window.addEventListener("resize", this.reposition, { passive: true });
  }

  setMode(mode: string): void {
    this.bar.classList.toggle("insert", mode === "insert");
  }

  show(): void {
    this.visible = true;
    this.host.style.display = "";
    this.reposition();
  }

  hide(): void {
    this.visible = false;
    this.host.style.display = "none";
  }

  reposition = (): void => {
    if (!this.visible) return;
    const r = this.field.element.getBoundingClientRect();
    const wrap = this.bar.parentElement!;
    wrap.style.left = `${r.left}px`;
    wrap.style.top = `${r.bottom}px`;
    wrap.style.width = `${r.width}px`;
    this.mirrorContainer.style.height = `${Math.max(16, r.height)}px`;
  };

  destroy(): void {
    window.removeEventListener("scroll", this.reposition, { capture: true });
    window.removeEventListener("resize", this.reposition);
    this.host.remove();
  }
}
