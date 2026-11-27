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
