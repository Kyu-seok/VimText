/**
 * The Playwright option that picks which of Monaco's two input kinds the
 * Monaco fixture's editor takes typing through (tests/fixtures/monaco.ts), so
 * one spec runs on `textarea.inputarea` and, in the `e2e monaco edit-context`
 * project, on the EditContext input (#117). Set per project in
 * playwright.config.ts and read by `openMonaco` (tests/e2e/monaco.ts): a spec
 * does not read it itself.
 */
export interface MonacoInputOption {
  monacoInput: "textarea" | "editContext";
}
