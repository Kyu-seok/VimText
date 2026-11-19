import { Sessions } from "./content/Sessions";
import { surround } from "./plugins/surround";
import { targets } from "./plugins/targets";
import { loadSettings, siteOrigin, watchSettings } from "./settings/settings";
import { loadSessionState, saveSessionState, watchSessionState } from "./settings/sessionState";

const site = siteOrigin(location);
const sessions = new Sessions(
  document,
  { load: loadSettings, watch: watchSettings },
  site,
  { load: loadSessionState, save: saveSessionState, watch: watchSessionState },
  { surround, targets },
);
// Marks this document as attended, per frame, and again once the settings have arrived:
// the e2e helper `ready` waits for the second mark instead of guessing when `document_idle`
// has passed and the storage read has answered. Until then an Activation key is only
// remembered and the keys after it are the page's (DESIGN.md "Settings").
document.documentElement.setAttribute("data-vimtext", "");
void sessions.policyKnown.then(() => document.documentElement.setAttribute("data-vimtext", "ready"));

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
