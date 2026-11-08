import type { Plugin, PluginContext } from "./Plugin";

/**
 * targets (oracle: targets.vim's `doc/targets.txt` with its default settings;
 * DESIGN.md "Plugins"). Typed `in`, `an`, `il`, `al` in operator-pending and
 * Visual reach the engine as Plugin Keys through the bridge's hook, and the
 * object key that follows completes them as the binding's `<character>`.
 */

const SEEK_RULES = (context: PluginContext) => [
  { context, typed: "in", key: "TargetsIn" },
  { context, typed: "an", key: "TargetsAn" },
  { context, typed: "il", key: "TargetsIl" },
  { context, typed: "al", key: "TargetsAl" },
];

export const targets: Plugin = {
  keys: [...SEEK_RULES("operator-pending"), ...SEEK_RULES("visual")],

  define() {},

  bind() {},
};
