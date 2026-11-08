// The Mode vocabulary of the engine seam. No engine imports: the popup reads
// this file too, and must not bundle the engine.

/** The closed set of GLOSSARY.md "Mode": the Vim editing Mode a Field is in. */
const MODES = [
  "normal",
  "insert",
  "replace",
  "visual",
  "visual-line",
  "visual-block",
  "command-line",
] as const;

export type Mode = (typeof MODES)[number];

/** The adapter's `vim.mode` strings, keyed to the Mode each one means. */
const ENGINE_MODES: Readonly<Record<string, Mode>> = {
  normal: "normal",
  insert: "insert",
  replace: "replace",
  visual: "visual",
  "visual line": "visual-line",
  "visual block": "visual-block",
};

/**
 * The adapter leaves `vim.mode` unset until the first mode change; that is
 * Normal. A string outside the table is engine drift (an upgrade adding a
 * mode) and throws rather than guessing, as `Mirror.vim` does for missing state.
 */
export function modeFromEngine(engineMode: string | undefined): Mode {
  if (engineMode === undefined) return "normal";
  if (!Object.hasOwn(ENGINE_MODES, engineMode))
    throw new Error(`VimText: unknown engine mode "${engineMode}"`);
  return ENGINE_MODES[engineMode]!;
}

/**
 * The popup's label for each Mode: Vim's showmode text where there is one
 * (`-- VISUAL LINE --` without the dashes). The Status Line's text is the engine's own.
 */
const LABELS: Readonly<Record<Mode, string>> = {
  normal: "NORMAL",
  insert: "INSERT",
  replace: "REPLACE",
  visual: "VISUAL",
  "visual-line": "VISUAL LINE",
  "visual-block": "VISUAL BLOCK",
  "command-line": "COMMAND-LINE",
};

export function modeLabel(mode: Mode): string {
  return LABELS[mode];
}

/** Narrows a value that crossed a message boundary (the popup's `vimtext:focused-mode` answer). */
export function isMode(value: unknown): value is Mode {
  return (MODES as readonly unknown[]).includes(value);
}
