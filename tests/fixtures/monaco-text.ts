/** The text the Monaco fixture's editor opens with (monaco.ts), shared with its specs: eight lines, the last empty. */
export const MONACO_TEXT = [
  "function add(a, b) {",
  "  return a + b;",
  "}",
  "",
  "function twice(n) {",
  "  return add(n, n);",
  "}",
  "",
].join("\n");

/** The text of the fixture's second code editor (`?second=1`): three lines, the last empty. */
export const SECOND_TEXT = ["const one = 1;", "const two = 2;", ""].join("\n");

/** The text of the fixture's one-line editor (`?oneLine=1`). */
export const ONE_LINE_TEXT = "one line of text";
