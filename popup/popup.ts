import { loadSettings, setSitePolicy, updateSettings, type SitePolicy } from "../src/settings/settings";

const enabled = document.getElementById("enabled") as HTMLInputElement;
const policy = document.getElementById("policy") as HTMLSelectElement;
const originEl = document.getElementById("origin")!;
const modeEl = document.getElementById("mode")!;
const optionsLink = document.getElementById("options")!;

interface Status {
  origin: string;
  /** Mode of the focused Field, or null when no Field is activated. */
  mode: string | null;
}

async function currentStatus(): Promise<Status | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  try {
    const res = (await chrome.tabs.sendMessage(tab.id, { type: "vimtext:status" })) as
      Partial<Status> | undefined;
    return res?.origin ? { origin: res.origin, mode: res.mode ?? null } : null;
  } catch {
    return null;
  }
}

async function init(): Promise<void> {
  const settings = await loadSettings();
  enabled.checked = settings.enabled;
  const status = await currentStatus();
  const origin = status?.origin ?? null;
  if (!origin) {
    originEl.textContent = "VimText is not running on this page.";
    policy.disabled = true;
  } else {
    originEl.textContent = origin;
    modeEl.textContent = status?.mode ? status.mode.toUpperCase() : "No Field activated";
    policy.value = settings.sites[origin] ?? "insert";
  }
  enabled.addEventListener(
    "change",
    () =>
      void updateSettings((s) => {
        s.enabled = enabled.checked;
      }),
  );
  policy.addEventListener("change", () => {
    if (!origin) return;
    const value = policy.value as SitePolicy;
    void updateSettings((s) => setSitePolicy(s, origin, value));
  });
  optionsLink.addEventListener("click", (e) => {
    e.preventDefault();
    void chrome.runtime.openOptionsPage();
  });
}

void init();
