import type { Plugin } from "./Plugin";

/**
 * surround (oracle: vim-surround's `doc/surround.txt`; DESIGN.md "Plugins").
 * Typed `ys`, `yss`, `cs`, `ds` in Normal and `S` in Visual reach the engine as
 * Plugin Keys through the bridge's hook; everything they mean is defined here.
 */
export const surround: Plugin = {
  keys: [
    { context: "normal", typed: "ys", key: "SurroundYs" },
    { context: "normal", typed: "yss", key: "SurroundYss" },
    { context: "normal", typed: "cs", key: "SurroundCs" },
    { context: "normal", typed: "ds", key: "SurroundDs" },
    { context: "visual", typed: "S", key: "SurroundS" },
  ],
  define() {},
  bind() {},
};
