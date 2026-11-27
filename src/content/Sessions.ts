import type { Field } from "../field/Field";
import { resolveField, type ResolvedField } from "../field/resolve";
import { isWriteKey } from "../field/editingCommands";
import { Session, isActivationKey } from "../bridge/Session";
import { policyFor, type Settings, type SitePolicy } from "../settings/settings";
import type { Plugin } from "../plugins/Plugin";
import { isStatusHost } from "../ui/statusHost";
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
  field: Field;
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
  attributeFilter: ["type", "readonly", "disabled", "contenteditable", "aria-multiline"],
};

/**
 * The content entry's state: one Session per activated Field, the listeners
 * that Activate and route keys, the lifecycle observer that disposes, and the
 * settings handling (DESIGN.md "Settings" and "Lifecycle").
 *
 * The Site Policy is unknown until the port delivers settings: nothing
 * Activates, and an Activation key reaches the page but is remembered for its
 * Field, a blur the page makes in answer to that key included (`remembered`).
 * Every delivery, the first load and each later change alike, runs one
 * handler: "off" disposes every Session; otherwise the focused Field is
 * reconciled against the policy.
 */
export class Sessions {
  /** Keyed by the Field's element, as `resolveField` names it. */
  private readonly sessions = new Map<HTMLElement, FieldSession>();
  private settings: Settings | null = null;
  /**
   * The Activation key pressed while the policy was unknown, the last one
   * only: its Field, and its event, since a `focusout` during the event's
   * dispatch is the page's answer to the key. `blurredByKey` is true when the
   * page blurred the Field that way (Lexical's rich-text blurs its editor on
   * Escape, #79). With the policy known the page would never have seen that
   * key, so the arrival Activates the Field and focuses it again, as long as
   * nothing else took focus meanwhile. Any other blur forgets the key.
   * Covered by `tests/unit/sessions.test.ts`, "Activation key before settings
   * arrive": a textarea, a Single-line Field, a contenteditable host and a
   * Field inside an open shadow root; Lexical itself by `tests/e2e/lexical.spec.ts`.
   */
  private remembered: { field: HTMLElement; key: KeyboardEvent; blurredByKey: boolean } | null = null;
  private lifecycleObserver: MutationObserver | null = null;
  /**
   * The Field the caret was last seen in. A Field nested in an editable root
   * (a Notion block, #69) is left and entered with no focus event, the root
   * keeping focus: a key or a selection change resolving to another Field
   * blurs this one's Session and focuses that one's (`caretIn`). Covered in
   * every mode by `tests/unit/contenteditable-session.test.ts`, "on a
   * Notion-like root, the caret leaving a block and coming back in each mode",
   * and in an open shadow root by `tests/unit/contenteditable-shadow.test.ts`.
   */
  private caretField: HTMLElement | null = null;
  private readonly stateSync: SessionStateSync | null;
  private announcePolicy: () => void = () => {};
  /**
   * Resolves once the first settings have arrived and been acted on: from then
   * on an Activation key is taken at once, not remembered. The content entry
   * marks the document on it, which the e2e helper `ready` waits for.
   */
  readonly policyKnown = new Promise<void>((resolve) => (this.announcePolicy = resolve));
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
    document.addEventListener("selectionchange", this.onSelectionChange);
    this.stopWatching = port.watch(this.onSettings);
    // A change delivered before the read resolves is newer than what the read returns.
    void port.load().then((s) => {
      if (!this.settings) this.onSettings(s);
    });
    this.stateSync = sessionState ? new SessionStateSync(sessionState) : null;
  }

  /** Mode of the Session on the focused Field, or null when it has none. */
  get focusedMode(): Session["mode"] | null {
    const resolved = this.resolve(deepActiveElement(this.document));
    const entry = resolved ? this.sessions.get(resolved.element) : undefined;
    return entry?.session.mode ?? null;
  }

  /** True while the lifecycle observer is connected: only while a Session exists. */
  get observing(): boolean {
    return this.lifecycleObserver !== null;
  }

  /** `resolveField` under the settings as they stand: the one way this class asks what is a Field. */
  private resolve(target: EventTarget | null): ResolvedField | null {
    return resolveField(target, { monaco: this.settings?.monaco ?? false });
  }

  /**
   * True while the element a Session is keyed by still resolves to a Field on
   * itself, of the kind its Field was made as: a host that gains or loses
   * `aria-multiline="false"` stops qualifying, and the next Activation makes a
   * Field of the new kind.
   */
  private stillQualifies(el: HTMLElement, field: Field): boolean {
    const resolved = this.resolve(el);
    return resolved?.element === el && resolved.singleLine === field.singleLine;
  }

  /** The Site Policy for this Site, or null while settings have not arrived. */
  private policy(): SitePolicy | null {
    return this.settings ? policyFor(this.settings, this.site) : null;
  }

  private activate(resolved: ResolvedField): void {
    const el = resolved.element;
    if (this.sessions.has(el)) return;
    if (this.remembered?.field === el) this.remembered = null;
    const field = resolved.create();
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

  private dispose(el: HTMLElement): void {
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
    this.announcePolicy();
  };

  /**
   * Brings the focused Field in line with a policy that just arrived: "normal"
   * Activates it, "insert" Activates it only if the remembered Activation key
   * was pressed on it. Never in a document without focus (a background tab or
   * frame), so a Field there is left alone. A remembered Field the page
   * blurred in answer to the key is focused again, while nothing else has
   * focus.
   */
  private reconcile(policy: "insert" | "normal"): void {
    if (!this.document.hasFocus()) return;
    const active = deepActiveElement(this.document);
    const blurred = this.remembered?.blurredByKey ? this.remembered.field : null;
    if (blurred?.isConnected && (active === null || active === this.document.body)) {
      const resolved = this.resolve(blurred);
      if (resolved?.element !== blurred) return;
      this.activate(resolved);
      const field = this.sessions.get(blurred)?.field;
      field?.focus();
      // A Field the page also hid on that key takes no focus: it is left as the page left it.
      if (!field?.hasFocus()) this.dispose(blurred);
      return;
    }
    const resolved = this.resolve(active);
    if (!resolved || this.sessions.has(resolved.element)) return;
    if (policy === "normal" || resolved.element === this.remembered?.field) this.activate(resolved);
  }

  private onKeydown = (e: KeyboardEvent): void => {
    // A line break a write offers as Shift+Enter (#70) is VimText's own write, not the person's key.
    if (isWriteKey(e)) return;
    // Any key on a Field with a Session may change Session State; the engine
    // handles it synchronously inside this listener, so a snapshot queued now
    // sees the result. Keys inside the command line are handled by its own
    // input's listener, after this one: those are caught by `onDialog`.
    if (this.sessions.size) this.stateSync?.queueSnapshot();
    const resolved = this.resolve(deepTarget(e));
    if (!resolved) return;
    this.caretIn(resolved.element);
    const entry = this.sessions.get(resolved.element);
    if (entry) {
      entry.session.handleKeydown(e);
      return;
    }
    if (e.isComposing || !isActivationKey(e)) return;
    const policy = this.policy();
    if (policy === null) {
      // Unknown policy: the page sees the key as it would on an "off" site,
      // and the arrival decides whether it was an Activation.
      this.remembered = { field: resolved.element, key: e, blurredByKey: false };
      return;
    }
    if (policy === "off") return;
    e.preventDefault();
    e.stopPropagation();
    this.activate(resolved);
  };

  /** The caret moved into `el` without a focus event: the Session it left loses focus, the one it entered gains it. */
  private caretIn(el: HTMLElement): void {
    const left = this.caretField;
    this.caretField = el;
    if (left === null || left === el) return;
    this.sessions.get(left)?.session.onBlur();
    this.sessions.get(el)?.session.onFocus();
  }

  private onSelectionChange = (): void => {
    if (!this.sessions.size) return;
    const resolved = this.resolve(deepActiveElement(this.document));
    if (resolved) this.caretIn(resolved.element);
  };

  private onFocusin = (e: FocusEvent): void => {
    const resolved = this.resolve(deepTarget(e));
    if (!resolved) return;
    this.caretField = resolved.element;
    const entry = this.sessions.get(resolved.element);
    if (entry) entry.session.onFocus();
    else if (this.policy() === "normal") this.activate(resolved);
  };

  private onFocusout = (e: FocusEvent): void => {
    const resolved = this.resolve(deepTarget(e));
    if (!resolved) return;
    this.sessions.get(resolved.element)?.session.onBlur();
    if (this.caretField === resolved.element) this.caretField = null;
    if (this.remembered?.field === resolved.element) {
      // Still being dispatched: a listener of the key itself took the focus away.
      if (this.remembered.key.eventPhase !== Event.NONE) this.remembered.blurredByKey = true;
      else this.remembered = null;
    }
  };

  // Disposal is prompt (ADR 0003): a Session ends when its Field leaves the
  // page (framework re-mounts included) or stops qualifying (readonly,
  // disabled, type changed to password, a host no longer contenteditable),
  // not on the next focus change
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
        for (const [el, { field }] of [...this.sessions])
          if (!el.isConnected || !this.stillQualifies(el, field)) this.dispose(el);
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
    this.document.removeEventListener("selectionchange", this.onSelectionChange);
  }
}
