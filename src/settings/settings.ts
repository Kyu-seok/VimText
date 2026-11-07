/** Site Policy: what VimText does on a given origin. */
export type SitePolicy = "off" | "insert" | "normal";

export interface Settings {
  /** Global kill switch. */
  enabled: boolean;
  /** Site Policy by origin (scheme + host [+ port]). Unknown origins → "insert". */
  sites: Record<string, SitePolicy>;
  /** Ex commands run on every Activation. */
  vimrc: string;
  plugins: { surround: boolean; targets: boolean };
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  sites: {},
  vimrc: "",
  plugins: { surround: false, targets: false },
};

export function policyFor(settings: Settings, origin: string): SitePolicy {
  if (!settings.enabled) return "off";
  return settings.sites[origin] ?? "insert";
}

/** "insert" is the default, so choosing it forgets the origin rather than storing it. */
export function setSitePolicy(settings: Settings, origin: string, policy: SitePolicy): void {
  if (policy === "insert") delete settings.sites[origin];
  else settings.sites[origin] = policy;
}

function merge(stored: Partial<Settings> | undefined): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    sites: { ...(stored?.sites ?? {}) },
    plugins: { ...DEFAULT_SETTINGS.plugins, ...(stored?.plugins ?? {}) },
  };
}

export async function loadSettings(): Promise<Settings> {
  const stored = (await chrome.storage.sync.get("settings")) as { settings?: Partial<Settings> };
  return merge(stored.settings);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ settings });
}

export async function updateSettings(patch: (s: Settings) => void): Promise<Settings> {
  const s = await loadSettings();
  patch(s);
  await saveSettings(s);
  return s;
}

/** Calls `handler` with fresh settings whenever they change in any context. */
export function watchSettings(handler: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== "sync" || !("settings" in changes)) return;
    handler(merge(changes["settings"]?.newValue as Partial<Settings> | undefined));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
