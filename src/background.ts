// The service worker's one job: let content scripts reach session storage,
// where Session State lives (DESIGN.md "Session State"). Nothing else runs here;
// the content script remains the only place with behaviour.
const grant = () =>
  void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });

chrome.runtime.onInstalled.addListener(grant);
chrome.runtime.onStartup.addListener(grant);
