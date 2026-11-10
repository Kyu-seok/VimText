import { describe, it, expect, afterEach } from "vitest";
import { TextareaField } from "../../src/field/TextareaField";
import { Session } from "../../src/bridge/Session";
import { keyDriver } from "./keys";

let ta: HTMLTextAreaElement;
let field: TextareaField;
let session: Session;
const { keys } = keyDriver(() => session);

const LINES: [string, string, string] = [
  "The first line is long enough to pass the height oracle's guess",
  "and the second line is just as long, so it never wraps either",
  "third line",
];

function activate(width: string): void {
  ta = document.createElement("textarea");
  ta.value = LINES.join("\n");
  ta.style.cssText = `width:${width};height:200px;font:14px/1.4 monospace`;
  document.body.appendChild(ta);
  ta.focus();
  ta.setSelectionRange(0, 0);
  field = new TextareaField(ta);
  session = new Session(field, { vimrc: "" });
}

afterEach(() => {
  session.destroy();
  field.destroy();
  ta.remove();
});

describe("the first vertical motion after Activation", () => {
  it("j on a wide Field with long unwrapped lines moves one line down", () => {
    activate("1200px");
    keys("j");
    expect(ta.selectionStart).toBe(LINES[0].length + 1);
  });
});
