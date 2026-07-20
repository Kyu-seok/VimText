// dom/search-ui.js — a tiny "/pattern" prompt shown at the bottom of the page.
// It only collects the pattern; the engine does the actual searching. Resolves
// with the typed string (Enter) or null (Escape).

let wrap = null;
let input = null;

function ensureSearchBox() {
  if (wrap) return;
  wrap = document.createElement("div");
  wrap.id = "vimtext-search";
  Object.assign(wrap.style, {
    position: "fixed",
    left: "0",
    right: "0",
    bottom: "0",
    zIndex: "2147483647",
    display: "none",
    background: "#1e1e1e",
    color: "#eee",
    font: "13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace",
    padding: "6px 10px",
    boxShadow: "0 -1px 6px rgba(0,0,0,.4)",
  });

  const row = document.createElement("div");
  Object.assign(row.style, {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    maxWidth: "900px",
    margin: "0 auto",
  });

  const prefix = document.createElement("span");
  prefix.textContent = "/";
  prefix.style.opacity = "0.8";

  input = document.createElement("input");
  input.type = "text";
  input.id = "vimtext-search-input";
  input.autocomplete = "off";
  input.spellcheck = false;
  Object.assign(input.style, {
    flex: "1",
    background: "transparent",
    border: "none",
    outline: "none",
    color: "inherit",
    font: "inherit",
  });

  row.appendChild(prefix);
  row.appendChild(input);
  wrap.appendChild(row);
  (document.body || document.documentElement).appendChild(wrap);
}

export function openSearch() {
  ensureSearchBox();
  input.value = "";
  wrap.style.display = "block";
  input.focus();

  return new Promise((resolve) => {
    const done = (val) => {
      wrap.style.display = "none";
      input.removeEventListener("keydown", onKey);
      resolve(val);
    };
    const onKey = (e) => {
      // These keys are ours; keep them from reaching the page.
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        done(input.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        done(null);
      }
    };
    input.addEventListener("keydown", onKey);
  });
}
