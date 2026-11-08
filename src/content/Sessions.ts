import { isTextControl, type TextControl } from "../field/Field";
import { TextareaField } from "../field/TextareaField";
import { Session, isActivationKey } from "../bridge/Session";
import { policyFor, type Settings, type SitePolicy } from "../settings/settings";
import type { Plugin } from "../plugins/Plugin";
import { SessionStateSync, type SessionStatePort } from "./SessionStateSync";

/**
 * The Plugins VimText can enable, by the name of their Settings toggle. An
 * enabled one is bound on every Activation, before the vimrc (DESIGN.md
 * "Settings"); the content entry passes the real registry.
 */
export type PluginRegistry = Partial<Record<keyof Settings["plugins"], Plugin>>;

/** Where settings come from: a one-time read, then every later change. */
export interface SettingsPort {
  load(): Promise<Settings>;
  watch(handler: (s: Settings) => void): () => void;
}

interface FieldSession {
  field: TextareaField;
  session: Session;
}

function deepTarget(e: Event): EventTarget | null {
  const path = e.composedPath();
  return path.length ? path[0]! : e.target;
}

/** The focused element, followed through open shadow roots. */
function deepActiveElement(doc: Document): Element | null {
  let el = doc.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
}

function isStatusHost(node: Node): boolean {
  return node instanceof Element && node.localName === "vimtext-status";
}

/** True when a record can affect a Session; our own Status Line hosts coming and going cannot. */
function concernsFields(record: MutationRecord): boolean {
  if (record.type === "attributes") return true;
  for (const n of record.addedNodes) if (!isStatusHost(n)) return true;
  for (const n of record.removedNodes) if (!isStatusHost(n)) return true;
  return false;
}

const lifecycleOptions: MutationObserverInit = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["type", "readonly", "disabled"],
};

/**
 * The content entry's state: one Session per activated Field, the listeners
 * that Activate and route keys, the lifecycle observer that disposes, and the
 * settings handling (DESIGN.md "Settings" and "Lifecycle").
 *
 * The Site Policy is unknown until the port delivers settings: nothing
 * Activates, and an Activation key reaches the page but is remembered for its
 * Field. Every delivery, the first load and each later change alike, runs one
 * handler: "off" disposes every Session; otherwise the focused Field is
 * reconciled against the policy.
 */
export class Sessions {
  private readonly sessions = new Map<TextControl, FieldSession>();
  private settings: Settings | null = null;
  /** The Field an Activation key was pressed on while the policy was unknown; the last one only. */
  private remembered: TextControl | null = null;
  private lifecycleObserver: MutationObserver | null = null;
  private readonly stateSync: SessionStateSync | null;
  private readonly stopWatching: () => void;

  /**
   * `site` is the origin the Site Policy is keyed by: the top page's, which in
   * a frame is not the document's own (ADR 0005). Resolving it is the content
   * entry's job (`siteOrigin`), so this class never reads `ancestorOrigins`.
   *
   * `sessionState` is optional so a test of something else needs no storage;
   * the content entry always passes one. `plugins` is the registry of
   * Plugins that may be enabled; a test of something else passes none.
   */
  constructor(
    private readonly document: Document,
    port: SettingsPort,
    private readonly site: string,
    sessionState: SessionStatePort | null = null,
    private readonly plugins: PluginRegistry = {},
  ) {
    document.addEventListener("keydown", this.onKeydown, { capture: true });
    document.addEventListener("focusin", this.onFocusin);
    document.addEventListener("focusout", this.onFocusout);
    this.stopWatching = port.watch(this.onSettings);
    // A change delivered before the read resolves is newer than what the read returns.
    void port.load().then((s) => {
      if (!this.settings) this.onSettings(s);
    });
    this.stateSync = sessionState ? new SessionStateSync(sessionState) : null;
  }

  /** Mode of the Session on the focused Field, or null when it has none. */
  get focusedMode(): Session["mode"] | null {
    const active = deepActiveElement(this.document);
    const entry = isTextControl(active) ? this.sessions.get(active) : undefined;
    return entry?.session.mode ?? null;
  }

  /** True while the lifecycle observer is connected: only while a Session exists. */
  get observing(): boolean {
    return this.lifecycleObserver !== null;
  }

  /** The Site Policy for this Site, or null while settings have not arrived. */
  private policy(): SitePolicy | null {
    return this.settings ? policyFor(this.settings, this.site) : null;
  }

  private activate(el: TextControl): void {
    if (this.sessions.has(el)) return;
    if (this.remembered === el) this.remembered = null;
    const field = new TextareaField(el);
    const session = new Session(field, {
      vimrc: this.settings?.vimrc ?? "",
      plugins: this.enabledPlugins(),
      onDialog: () => this.stateSync?.queueSnapshot(),
    });
    this.sessions.set(el, { field, session });
    this.observeLifecycle(el.getRootNode());
  }

  /** The registered Plugins the settings enable, in registry order. */
  private enabledPlugins(): Plugin[] {
    const toggles = this.settings?.plugins;
    if (!toggles) return [];
    return (Object.keys(this.plugins) as Array<keyof PluginRegistry>)
      .filter((name) => toggles[name])
      .map((name) => this.plugins[name]!);
  }

  private dispose(el: TextControl): void {
    const entry = this.sessions.get(el);
    if (!entry) return;
    entry.session.destroy();
    entry.field.destroy();
    this.sessions.delete(el);
    if (this.sessions.size === 0) this.stopObservingLifecycle();
  }

  private disposeAll(): void {
    for (const el of [...this.sessions.keys()]) this.dispose(el);
  }

  private onSettings = (s: Settings): void => {
    this.settings = s;
    const policy = policyFor(s, this.site);
    if (policy === "off") this.disposeAll();
    else this.reconcile(policy);
    // The arrival has decided what the remembered key was; a later change must not Activate from it.
    this.remembered = null;
  };

  /**
   * Brings the focused Field in line with a policy that just arrived: "normal"
   * Activates it, "insert" Activates it only if the remembered Activation key
   * was pressed on it. Never in a document without focus (a background tab or
   * frame), so a Field there is left alone.
   */
  private reconcile(policy: "insert" | "normal"): void {
    if (!this.document.hasFocus()) return;
    const el = deepActiveElement(this.document);
    if (!isTextControl(el) || this.sessions.has(el)) return;
    if (policy === "normal" || el === this.remembered) this.activate(el);
  }

  private onKeydown = (e: KeyboardEvent): void => {
    // Any key on a Field with a Session may change Session State; the engine
    // handles it synchronously inside this listener, so a snapshot queued now
    // sees the result. Keys inside the command line are handled by its own
    // input's listener, after this one: those are caught by `onDialog`.
    if (this.sessions.size) this.stateSync?.queueSnapshot();
    const target = deepTarget(e);
    if (!isTextControl(target)) return;
    const entry = this.sessions.get(target);
    if (entry) {
      entry.session.handleKeydown(e);
      return;
    }
    if (e.isComposing || !isActivationKey(e)) return;
    const policy = this.policy();
    if (policy === null) {
      // Unknown policy: the page sees the key as it would on an "off" site,
      // and the arrival decides whether it was an Activation.
      this.remembered = target;
      return;
    }
    if (policy === "off") return;
    e.preventDefault();
    e.stopPropagation();
    this.activate(target);
  };

  private onFocusin = (e: FocusEvent): void => {
    const target = deepTarget(e);
    if (!isTextControl(target)) return;
    const entry = this.sessions.get(target);
    if (entry) entry.session.onFocus();
    else if (this.policy() === "normal") this.activate(target);
  };

  private onFocusout = (e: FocusEvent): void => {
    const target = deepTarget(e);
    if (!isTextControl(target)) return;
    this.sessions.get(target)?.session.onBlur();
    if (this.remembered === target) this.remembered = null;
  };

  // Disposal is prompt (ADR 0003): a Session ends when its Field leaves the
  // page (framework re-mounts included) or stops qualifying (readonly,
  // disabled, type changed to password), not on the next focus change
  // elsewhere. The observer runs only while a Session exists, so an inert
  // page costs nothing.

  /**
   * Starts the observer if it is not running and adds the new Field's root to
   * it: records from inside a shadow tree never reach an observer on the
   * document, so a Field in an open shadow root (reached through `composedPath`
   * on activation) is watched at its own root. One observer may observe many
   * targets; `disconnect()` drops them all.
   */
  private observeLifecycle(root: Node): void {
    if (!this.lifecycleObserver) {
      this.lifecycleObserver = new MutationObserver((records) => {
        if (!records.some(concernsFields)) return;
        for (const el of [...this.sessions.keys()])
          if (!el.isConnected || !isTextControl(el)) this.dispose(el);
      });
      this.lifecycleObserver.observe(this.document, lifecycleOptions);
    }
    if (root instanceof ShadowRoot) this.lifecycleObserver.observe(root, lifecycleOptions);
  }

  private stopObservingLifecycle(): void {
    this.lifecycleObserver?.disconnect();
    this.lifecycleObserver = null;
  }

  /** Disposes every Session and stops listening; the content script never calls this, tests do. */
  destroy(): void {
    this.disposeAll();
    this.stopWatching();
    this.stateSync?.destroy();
    this.document.removeEventListener("keydown", this.onKeydown, { capture: true });
    this.document.removeEventListener("focusin", this.onFocusin);
    this.document.removeEventListener("focusout", this.onFocusout);
  }
}
