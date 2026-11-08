import { Vim } from "@replit/codemirror-vim";
import type { ActionFn, CodeMirrorV, MotionFn, OperatorFn, Pos, vimKey } from "@replit/codemirror-vim";

// The engine types a Plugin module writes its commands against; the engine
// package itself is imported only here (tools/check-imports.mjs).
export type { CodeMirrorV, OperatorFn, Pos, vimKey };

/**
 * The slice of the engine API a Plugin defines and binds through (see the
 * Plugin bindings and Replay seams in docs/engine-seams.md). A definition
 * persists for the page and replaces the previous one by name; a binding
 * lands in the user partition that the Activation's `mapclear` wipes, so a
 * Plugin binds again on every Activation.
 */
export interface EngineApi {
  defineOperator(name: string, fn: OperatorFn): void;
  defineMotion(name: string, fn: MotionFn): void;
  defineAction(name: string, fn: ActionFn): void;
  /** Puts one keymap entry in front of every other; unlike `mapCommand` it can express `operatorMotion`. */
  bindKey(command: vimKey): void;
  /** Removes the user binding with exactly these keys in this context, if one exists. */
  unbindKey(keys: string, context: string): void;
  /** True while `.` or a macro replays. */
  replaying(): boolean;
}

export const engineApi: EngineApi = {
  defineOperator: (name, fn) => Vim.defineOperator(name, fn),
  defineMotion: (name, fn) => Vim.defineMotion(name, fn),
  defineAction: (name, fn) => Vim.defineAction(name, fn),
  bindKey: (command) => Vim._mapCommand(command),
  unbindKey: (keys, context) => Vim.unmap(keys, context),
  replaying: () => Vim.getVimGlobalState_().macroModeState.isPlaying,
};
