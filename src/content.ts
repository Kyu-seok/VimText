import { Sessions } from "./content/Sessions";
import { loadSettings, watchSettings } from "./settings/settings";

const sessions = new Sessions(document, { load: loadSettings, watch: watchSettings });

chrome.runtime.onMessage.addListener((msg: { type?: string }, _sender, sendResponse) => {
  if (msg?.type === "vimtext:status") {
    sendResponse({
      origin: location.origin,
      mode: sessions.focusedMode,
      top: window === window.top,
      // The e2e lifecycle spec checks the observer runs only while a Session exists.
      observing: sessions.observing,
    });
  }
  return false;
});
