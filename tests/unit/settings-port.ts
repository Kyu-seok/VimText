import type { SettingsPort } from "../../src/content/Sessions";
import { DEFAULT_SETTINGS, type Settings, type SitePolicy } from "../../src/settings/settings";

/** Settings with this origin's Site Policy set; `null` leaves the origin unknown ("insert"). */
export function settingsFor(policy: SitePolicy | null, vimrc = ""): Settings {
  return { ...DEFAULT_SETTINGS, vimrc, sites: policy ? { [location.origin]: policy } : {} };
}

/** A settings port whose load and later deliveries the test controls. */
export function controlledPort() {
  let resolveLoad: (s: Settings) => void = () => {};
  let handler: ((s: Settings) => void) | null = null;
  const port: SettingsPort = {
    load: () => new Promise<Settings>((r) => (resolveLoad = r)),
    watch: (h) => {
      handler = h;
      return () => (handler = null);
    },
  };
  return {
    port,
    /** The storage read completes. */
    arrive: (s: Settings) => resolveLoad(s),
    /** A later change, as the popup or options page would make. */
    change: (s: Settings) => handler?.(s),
  };
}
