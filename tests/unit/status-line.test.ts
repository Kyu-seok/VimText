import { describe, it, expect, afterEach } from "vitest";
import { TextareaField } from "../../src/field/TextareaField";
import { Session } from "../../src/bridge/Session";

/**
 * Where the Status Line lands (DESIGN.md "Status Line"): below the Field when
 * the strip fits in the viewport there, above it otherwise, so a Field flush
 * with the bottom of a short iframe keeps a visible strip. Observed from
 * outside through hit testing: the point just past the Field's edge hits
 * VimText's host element or it does not. Coverage: Normal on a textarea; the
 * placement does not depend on Mode or Field type.
 */

let ta: HTMLTextAreaElement;
let field: TextareaField;
let session: Session;

function mount(position: string): void {
  ta = document.createElement("textarea");
  ta.value = "the quick brown fox";
  ta.style.cssText = `position:fixed; left:0; width:300px; height:60px; margin:0; font:14px/1.4 monospace; ${position}`;
  document.body.appendChild(ta);
  ta.focus();
  field = new TextareaField(ta);
  session = new Session(field, { vimrc: "" });
}

/** The element at `dy` px from the Field's top (negative) or bottom (positive) edge. */
function hitAt(dy: number): Element | null {
  const r = ta.getBoundingClientRect();
  return document.elementFromPoint(r.left + 20, dy < 0 ? r.top + dy : r.bottom + dy);
}

afterEach(() => {
  session.destroy();
  field.destroy();
  ta.remove();
});

describe("Status Line placement", () => {
  it("sits below a Field with room under it", () => {
    mount("top:0");
    expect(hitAt(8)?.localName).toBe("vimtext-status");
    expect(hitAt(-8)?.localName).not.toBe("vimtext-status");
  });

  it("sits above a Field flush with the bottom of the viewport", () => {
    mount("bottom:0");
    expect(hitAt(-8)?.localName).toBe("vimtext-status");
  });
});
