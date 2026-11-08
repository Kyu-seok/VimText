import { Mirror } from "./mirror";

/**
 * The vimrc's runnable lines: the leading `:` and whitespace stripped, blank
 * and `"` comment lines skipped, each with its 1-based line number so an
 * error can name the line the user wrote.
 */
export function vimrcLines(vimrc: string): Array<{ line: number; text: string }> {
  return vimrc
    .split("\n")
    .map((raw, i) => ({ line: i + 1, text: raw.replace(/^\s*:?/, "").trim() }))
    .filter(({ text }) => text && !text.startsWith('"'));
}

export interface VimrcError {
  /** 1-based line number in the vimrc as the user wrote it. */
  line: number;
  /** The line, normalised as it is run. */
  text: string;
  /** The engine's message. */
  error: string;
}

/**
 * Runs a vimrc through a scratch mirror, line by line, and reports the first
 * error of each failing line: what the options page shows under the text box
 * on save. The engine reports most mistakes (`Not an editor command`,
 * `Unknown option`, `No such mapping`) as a red notice in its dialog rather
 * than a throw, so a new dialog after a line counts as that line's error.
 * Mappings are global per frame: the scratch run clears user mappings before
 * and after, so it leaves none behind in the page that called it.
 */
export function checkVimrc(vimrc: string): VimrcError[] {
  const scratch = document.createElement("div");
  scratch.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden";
  const input = document.createElement("textarea");
  const statusbar = document.createElement("div");
  scratch.append(input, statusbar);
  document.body.appendChild(scratch);
  const mirror = new Mirror({
    container: scratch,
    inputField: input,
    focus: () => {},
    doc: "",
    cursor: 0,
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
  const errors: VimrcError[] = [];
  try {
    mirror.clearUserMappings();
    for (const { line, text } of vimrcLines(vimrc)) {
      const before = mirror.dialog;
      let error: string | null = null;
      try {
        mirror.handleEx(text);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
      const after = mirror.dialog;
      if (error === null && after && after !== before) error = after.textContent?.trim() ?? "";
      if (error !== null) errors.push({ line, text, error });
    }
    mirror.clearUserMappings();
  } finally {
    mirror.destroy();
    scratch.remove();
  }
  return errors;
}
