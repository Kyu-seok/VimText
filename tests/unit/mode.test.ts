import { describe, it, expect } from "vitest";
import { isMode, modeLabel } from "../../src/engine/mode";

describe("Mode labels", () => {
  it("spell Vim's showmode text, which has a space in VISUAL LINE", () => {
    expect(modeLabel("normal")).toBe("NORMAL");
    expect(modeLabel("visual-line")).toBe("VISUAL LINE");
    expect(modeLabel("visual-block")).toBe("VISUAL BLOCK");
  });
});

describe("isMode", () => {
  it("accepts the closed set and rejects the adapter's own spelling and non-strings", () => {
    expect(isMode("replace")).toBe(true);
    expect(isMode("command-line")).toBe(true);
    expect(isMode("visual line")).toBe(false);
    expect(isMode(null)).toBe(false);
    expect(isMode("toString")).toBe(false);
  });
});
