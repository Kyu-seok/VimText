import { loadSettings, updateSettings, type SitePolicy } from "../src/settings/settings";

const enabled = document.getElementById("enabled") as HTMLInputElement;
const policy = document.getElementById("policy") as HTMLSelectElement;
const originEl = document.getElementById("origin")!;
const optionsLink = document.getElementById("options")!;

async function currentOrigin(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  try {
    const res = (await chrome.tabs.sendMessage(tab.id, { type: "vimtext:status" })) as { origin?: string };
    return res?.origin ?? null;
  } catch {
    return null;
  }
}

async function init(): Promise<void> {
  const settings = await loadSettings();
  enabled.checked = settings.enabled;
  const origin = await currentOrigin();
  if (!origin) {
    originEl.textContent = "VimText is not running on this page.";
    policy.disabled = true;
  } else {
    originEl.textContent = origin;
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
    void updateSettings((s) => {
      if (value === "insert") delete s.sites[origin];
      else s.sites[origin] = value;
    });
  });
  optionsLink.addEventListener("click", (e) => {
    e.preventDefault();
    void chrome.runtime.openOptionsPage();
  });
}

void init();
