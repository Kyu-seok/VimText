import { loadSettings, setSitePolicy, updateSettings, type SitePolicy } from "../src/settings/settings";
import { isMode, modeLabel, type Mode } from "../src/engine/mode";

const enabled = document.getElementById("enabled") as HTMLInputElement;
const policy = document.getElementById("policy") as HTMLSelectElement;
const originEl = document.getElementById("origin")!;
const modeEl = document.getElementById("mode")!;
const optionsLink = document.getElementById("options")!;

interface Status {
  origin: string;
  /** Mode of the focused Field, or null when no Field is activated. */
  mode: Mode | null;
}

/** Sends a message to the tab's frames (one frame when `frameId` is given); no answer or no script → undefined. */
async function ask<T>(tabId: number, type: string, frameId?: number): Promise<T | undefined> {
  try {
    const options = frameId === undefined ? undefined : { frameId };
    return (await chrome.tabs.sendMessage(tabId, { type }, options)) as T | undefined;
  } catch {
    return undefined;
  }
}

/**
 * The Site comes from the top frame only, which also proves VimText runs there.
 * The Mode comes from whichever frame holds a Session on its active element
 * (DESIGN.md "Settings"), so a Field focused inside an iframe is reported.
 */
async function currentStatus(): Promise<Status | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  const top = await ask<{ origin?: string }>(tab.id, "vimtext:status", 0);
  if (!top?.origin) return null;
  const focused = await ask<{ mode?: unknown }>(tab.id, "vimtext:focused-mode");
  return { origin: top.origin, mode: isMode(focused?.mode) ? focused.mode : null };
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
    modeEl.textContent = status?.mode ? modeLabel(status.mode) : "No Field activated";
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
