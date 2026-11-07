import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, policyFor, setSitePolicy, type Settings } from "../../src/settings/settings";

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
