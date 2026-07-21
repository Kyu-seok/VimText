// options.js — global enable flag + the per-site disable list.

const enabledEl = document.getElementById("enabled");
const sitesEl = document.getElementById("sites");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");
const pSurround = document.getElementById("plugin-surround");
const pTargets = document.getElementById("plugin-targets");

const PLUGIN_DEFAULTS = { surround: true, targets: true };

function load() {
  chrome.storage.sync.get({ enabled: true, disabledSites: [], plugins: PLUGIN_DEFAULTS }, (v) => {
    enabledEl.checked = v.enabled;
    sitesEl.value = (v.disabledSites || []).join("\n");
    const p = v.plugins || PLUGIN_DEFAULTS;
    pSurround.checked = !!p.surround;
    pTargets.checked = !!p.targets;
  });
}

function savePlugins() {
  chrome.storage.sync.set({ plugins: { surround: pSurround.checked, targets: pTargets.checked } });
}

function parseSites(text) {
  const seen = new Set();
  for (const raw of text.split("\n")) {
    const host = raw.trim().toLowerCase();
    if (host) seen.add(host);
  }
  return [...seen];
}

function save() {
  const disabledSites = parseSites(sitesEl.value);
  chrome.storage.sync.set({ enabled: enabledEl.checked, disabledSites }, () => {
    sitesEl.value = disabledSites.join("\n");
    statusEl.textContent = "Saved";
    setTimeout(() => (statusEl.textContent = ""), 1500);
  });
}

enabledEl.addEventListener("change", () =>
  chrome.storage.sync.set({ enabled: enabledEl.checked })
);
saveBtn.addEventListener("click", save);
pSurround.addEventListener("change", savePlugins);
pTargets.addEventListener("change", savePlugins);

load();
