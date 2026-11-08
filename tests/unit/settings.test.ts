import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  policyFor,
  setSitePolicy,
  siteOrigin,
  type Settings,
} from "../../src/settings/settings";

function settingsWith(sites: Settings["sites"]): Settings {
  return { ...DEFAULT_SETTINGS, sites };
}

describe("Site Policy", () => {
  it("remembers 'normal' and 'off' for an origin", () => {
    const s = settingsWith({});
    setSitePolicy(s, "https://a.test", "normal");
    setSitePolicy(s, "https://b.test", "off");
    expect(s.sites).toEqual({ "https://a.test": "normal", "https://b.test": "off" });
  });

  it("drops the origin's entry when set back to the default 'insert'", () => {
    const s = settingsWith({ "https://a.test": "off" });
    setSitePolicy(s, "https://a.test", "insert");
    expect(s.sites).toEqual({});
    expect(policyFor(s, "https://a.test")).toBe("insert");
  });
});

describe("Site origin", () => {
  it("is a top-level document's own origin", () => {
    expect(siteOrigin({ origin: "https://a.test", ancestorOrigins: [] })).toBe("https://a.test");
  });

  it("is the embedding page's origin for a frame, not the frame's own", () => {
    expect(siteOrigin({ origin: "https://widget.test", ancestorOrigins: ["https://a.test"] })).toBe(
      "https://a.test",
    );
  });

  it("is the top page's origin for a nested frame: the last ancestor", () => {
    expect(
      siteOrigin({ origin: "https://inner.test", ancestorOrigins: ["https://mid.test", "https://a.test"] }),
    ).toBe("https://a.test");
  });

  it("falls back to the frame's own origin where the ancestor list is empty (Firefox)", () => {
    expect(siteOrigin({ origin: "https://widget.test", ancestorOrigins: [] })).toBe("https://widget.test");
  });
});
