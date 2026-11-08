import type { EngineApi } from "../engine/pluginApi";

/** Where the engine is when a Plugin claims a typed sequence; Insert is never one. */
export type PluginContext = "normal" | "operator-pending" | "visual";

/** One typed sequence the bridge's Plugin key hook turns into a Plugin Key (GLOSSARY.md). */
export interface PluginKeyRule {
  context: PluginContext;
  /** The keys as typed, one character each (`ds`). */
  typed: string;
  /** The Plugin Key's name without its brackets (`SurroundDs`); the engine sees `<SurroundDs>`. */
  key: string;
}

/**
 * A Plugin (GLOSSARY.md): engine commands defined once per page and bound on
 * every Activation, reached through the typed sequences `keys` claims
 * (DESIGN.md "Plugins", ADR 0006). The hook knows only `keys`; every
 * semantic lives behind `define`.
 */
export interface Plugin {
  readonly keys: readonly PluginKeyRule[];
  /** Defines operators, motions and actions; idempotent, run before every `bind`. */
  define(engine: EngineApi): void;
  /** Binds the Plugin Keys; run on every Activation, before the vimrc, so a vimrc mapping wins. */
  bind(engine: EngineApi): void;
  /**
   * The Field lost focus: a wait the Plugin armed in the engine is cancelled,
   * as Esc would, so a key typed in another Field never completes it.
   * Optional: a Plugin with no wait of its own (targets) has none.
   */
  onBlur?(): void;
}
