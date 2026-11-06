import { loadSettings, updateSettings, watchSettings, type Settings, type SitePolicy } from "../src/settings/settings";

const vimrc = document.getElementById("vimrc") as HTMLTextAreaElement;
const saveVimrc = document.getElementById("save-vimrc") as HTMLButtonElement;
const vimrcStatus = document.getElementById("vimrc-status")!;
const surround = document.getElementById("plugin-surround") as HTMLInputElement;
const targets = document.getElementById("plugin-targets") as HTMLInputElement;
const sitesBody = document.querySelector("#sites tbody") as HTMLTableSectionElement;

function renderSites(settings: Settings): void {
  sitesBody.textContent = "";
  const origins = Object.keys(settings.sites).sort();
  if (!origins.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="3" class="muted">No site-specific policies yet. Use the toolbar popup on a site to add one.</td>`;
    sitesBody.appendChild(tr);
    return;
  }
  for (const origin of origins) {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = origin;
    const sel = document.createElement("select");
    for (const [v, label] of [["insert", "On, start in Insert"], ["normal", "On, start in Normal"], ["off", "Off"]]) {
      const o = document.createElement("option");
      o.value = v!; o.textContent = label!;
      sel.appendChild(o);
    }
    sel.value = settings.sites[origin]!;
    sel.addEventListener("change", () => void updateSettings((s) => {
      if (sel.value === "insert") delete s.sites[origin]; else s.sites[origin] = sel.value as SitePolicy;
    }));
    const remove = document.createElement("button");
    remove.textContent = "Remove";
    remove.addEventListener("click", () => void updateSettings((s) => { delete s.sites[origin]; }));
    const c2 = document.createElement("td"); c2.appendChild(sel);
    const c3 = document.createElement("td"); c3.appendChild(remove);
    tr.append(name, c2, c3);
    sitesBody.appendChild(tr);
  }
}

function render(settings: Settings): void {
  if (document.activeElement !== vimrc) vimrc.value = settings.vimrc;
  surround.checked = settings.plugins.surround;
  targets.checked = settings.plugins.targets;
  renderSites(settings);
}

saveVimrc.addEventListener("click", () => {
  void updateSettings((s) => { s.vimrc = vimrc.value; }).then(() => {
    vimrcStatus.textContent = "Saved. Applies on the next Field activation.";
    setTimeout(() => (vimrcStatus.textContent = ""), 3000);
  });
});
surround.addEventListener("change", () => void updateSettings((s) => { s.plugins.surround = surround.checked; }));
targets.addEventListener("change", () => void updateSettings((s) => { s.plugins.targets = targets.checked; }));

void loadSettings().then(render);
watchSettings(render);
