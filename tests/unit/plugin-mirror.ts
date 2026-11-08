import { Mirror } from "../../src/engine/mirror";
import { engineApi } from "../../src/engine/pluginApi";
import type { Plugin } from "../../src/plugins/Plugin";

/**
 * Drives one Plugin at the mirror, under the one exception spec #24 grants to
 * CODING_STANDARDS rule 6: the Plugin is fed its Plugin Keys and object keys
 * directly, so that the hook's grammar (plugin-keys.test.ts) and the Plugin's
 * meaning are proven apart. Observed through what the Session renders into
 * the Field and the Status Line: the mirror's document, cursor and selection,
 * and the Mode text the engine renders into the statusbar (`--INSERT--`).
 */
export function pluginMirror(plugin: Plugin) {
  let mirror: Mirror | null = null;
  let scratch: HTMLElement | null = null;
  let statusbar: HTMLElement | null = null;

  /** A mirror over `doc` with the cursor at `cursor` and the Plugin bound, as an Activation binds it. */
  function open(doc: string, cursor: number): void {
    close();
    scratch = document.createElement("div");
    scratch.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden";
    const input = document.createElement("textarea");
    statusbar = document.createElement("div");
    scratch.append(input, statusbar);
    document.body.appendChild(scratch);
    mirror = new Mirror({
      container: scratch,
      inputField: input,
      focus: () => {},
      doc,
      cursor,
      style: {
        font: "13px monospace",
        letterSpacing: "normal",
        lineHeight: "normal",
        contentWidth: 400,
        whiteSpace: "pre-wrap",
        wordBreak: "normal",
        overflowWrap: "normal",
        tabSize: "8",
      },
      statusbar,
    });
    mirror.clearUserMappings();
    plugin.define(engineApi);
    plugin.bind(engineApi);
  }

  /** For `afterEach`: the bindings are global per page, so they go with the mirror. */
  function close(): void {
    mirror?.clearUserMappings();
    mirror?.destroy();
    scratch?.remove();
    mirror = null;
    scratch = null;
    statusbar = null;
  }

  /** Feeds keys: a single character as typed, a longer name as a Plugin Key or special key. */
  function feed(...keys: string[]): void {
    for (const key of keys) {
      mirror!.handleKey({
        key,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        shiftKey: false,
        preventDefault() {},
        stopPropagation() {},
      });
    }
  }

  /** The page rewrote the Field: what the Session's sync then dispatches into the mirror. */
  function rewrite(from: number, to: number, insert: string): void {
    mirror!.view.dispatch({ changes: { from, to, insert } });
  }

  const text = () => mirror!.view.state.doc.toString();
  const cursor = () => mirror!.view.state.selection.main.head;
  /** The Visual selection as the text it covers. */
  const selected = () => {
    const { from, to } = mirror!.view.state.selection.main;
    return mirror!.view.state.doc.sliceString(from, to);
  };
  /** The Mode as the engine renders it (`--NORMAL--`, `--INSERT--`), which the Status Line shows. */
  const status = () => statusbar!.textContent ?? "";

  return { open, close, feed, rewrite, text, cursor, selected, status };
}
