// options.js — global enable flag + the per-site disable list.

const enabledEl = document.getElementById("enabled");
const sitesEl = document.getElementById("sites");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");

function load() {
  chrome.storage.sync.get({ enabled: true, disabledSites: [] }, (v) => {
    enabledEl.checked = v.enabled;
    sitesEl.value = (v.disabledSites || []).join("\n");
  });
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

load();
