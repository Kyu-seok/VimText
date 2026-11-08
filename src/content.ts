import { Sessions } from "./content/Sessions";
import { loadSettings, siteOrigin, watchSettings } from "./settings/settings";

const site = siteOrigin(location);
const sessions = new Sessions(document, { load: loadSettings, watch: watchSettings }, site);
// Marks this document as attended, per frame; the e2e helper `ready` waits for it
// instead of guessing when `document_idle` has passed.
document.documentElement.setAttribute("data-vimtext", "");

chrome.runtime.onMessage.addListener((msg: { type?: string }, _sender, sendResponse) => {
  if (msg?.type === "vimtext:status") {
    // Asked of the top frame only (the popup, the e2e helper): the Site and this frame's state.
    sendResponse({
      origin: site,
      // The e2e lifecycle spec checks the observer runs only while a Session exists.
      observing: sessions.observing,
    });
  } else if (msg?.type === "vimtext:focused-mode") {
    // Asked of every frame; only the one holding a Session on its active element answers,
    // so a Field focused inside an iframe is reported. No answer resolves to undefined.
    const mode = sessions.focusedMode;
    if (mode) sendResponse({ mode });
  }
  return false;
});
