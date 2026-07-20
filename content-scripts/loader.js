// VimText loader — classic content script.
//
// MV3 content scripts declared in the manifest cannot use static ES `import`.
// So this tiny classic script dynamic-imports the real ES-module entry point.
// All engine/dom modules are listed in `web_accessible_resources` so they are
// importable via chrome.runtime.getURL(). The same files are imported directly
// by the Node test suite — no build step, no bundler.
(async () => {
  try {
    const src = chrome.runtime.getURL("content-scripts/index.js");
    const mod = await import(src);
    if (mod && typeof mod.init === "function") {
      mod.init();
    }
  } catch (err) {
    // Never throw into the host page; just log.
    console.error("[VimText] failed to initialize:", err);
  }
})();
