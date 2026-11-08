import type { PluginContext, PluginKeyRule } from "../plugins/Plugin";

/** What the hook decided for one typed key; the Session carries it out. */
export type HookStep =
  /** The key is held: it may still become a Plugin Key. Nothing reaches the engine. */
  | { kind: "hold" }
  /**
   * The held keys, with this key when `consumed`, complete a Plugin Key. When
   * not `consumed` the sequence ended one key earlier and this key still has
   * to take its own path.
   */
  | { kind: "plugin-key"; key: string; typed: string; consumed: boolean }
  /** The held keys turned out not to be a sequence: feed them, in order, then this key. */
  | { kind: "release"; held: string[] }
  /** Nothing held and nothing claimed. */
  | { kind: "pass" };

/**
 * The grammar of the Plugin key hook (DESIGN.md "Plugins", ADR 0006): which
 * typed sequences, in which engine context, become which Plugin Key. It holds
 * keys while a longer claimed sequence is still possible and knows nothing of
 * what a Plugin Key means. The context is the one the first held key saw:
 * nothing reaches the engine while keys are held, so it cannot change.
 */
export class PluginKeyHook {
  private held: string[] = [];
  private context: PluginContext | null = null;

  constructor(private readonly rules: readonly PluginKeyRule[]) {}

  /** True while keys are held: they count as pending input for the Key Policy. */
  get holding(): boolean {
    return this.held.length > 0;
  }

  /** Esc: what was held is forgotten and Esc goes to the engine as it would have. */
  discard(): void {
    this.held = [];
    this.context = null;
  }

  /**
   * @param context The engine's context for this key, null when none a Plugin
   *   claims (a partial key such as `g` or `"` is pending).
   * @param key The typed character, null for a key that cannot extend a
   *   sequence (a special or modified key).
   */
  step(context: PluginContext | null, key: string | null): HookStep {
    const held = this.held;
    const heldContext = this.context ?? context;
    const rules = heldContext ? this.rules.filter((r) => r.context === heldContext) : [];
    if (key !== null) {
      const typed = held.join("") + key;
      const exact = rules.find((r) => r.typed === typed);
      const longer = rules.some((r) => r.typed.length > typed.length && r.typed.startsWith(typed));
      if (longer) {
        this.held = [...held, key];
        this.context = heldContext;
        return { kind: "hold" };
      }
      if (exact) {
        this.discard();
        return { kind: "plugin-key", key: exact.key, typed, consumed: true };
      }
    }
    if (!held.length) return { kind: "pass" };
    const typedSoFar = held.join("");
    const heldRule = rules.find((r) => r.typed === typedSoFar);
    this.discard();
    if (heldRule) return { kind: "plugin-key", key: heldRule.key, typed: typedSoFar, consumed: false };
    return { kind: "release", held };
  }
}
