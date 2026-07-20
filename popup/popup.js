// popup.js — global on/off plus a quick "disable on this site" toggle.

const enabledEl = document.getElementById("enabled");
const siteEl = document.getElementById("siteDisabled");
const siteRow = document.getElementById("siteRow");
const hostEl = document.getElementById("host");
const openOptions = document.getElementById("openOptions");

let host = null;

async function activeHost() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab && tab.url ? new URL(tab.url).hostname : null;
  } catch {
    return null;
  }
}

async function init() {
  host = await activeHost();
  hostEl.textContent = host || "this site";
  if (!host) {
    siteEl.disabled = true;
    siteRow.classList.add("disabled");
  }
  chrome.storage.sync.get({ enabled: true, disabledSites: [] }, (v) => {
    enabledEl.checked = v.enabled;
    siteEl.checked = host ? v.disabledSites.includes(host) : false;
  });
}

enabledEl.addEventListener("change", () => {
  chrome.storage.sync.set({ enabled: enabledEl.checked });
});

siteEl.addEventListener("change", () => {
  if (!host) return;
  chrome.storage.sync.get({ disabledSites: [] }, (v) => {
    const set = new Set(v.disabledSites);
    if (siteEl.checked) set.add(host);
    else set.delete(host);
    chrome.storage.sync.set({ disabledSites: [...set] });
  });
});

openOptions.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

init();
