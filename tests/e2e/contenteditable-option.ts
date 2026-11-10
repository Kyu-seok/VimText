/**
 * The Playwright option a contenteditable spec reads its host's
 * `contenteditable` value from, so one spec runs on a `true` host and, in a
 * second project, on a `plaintext-only` one (#45). Shared by the spec, which
 * declares it, and playwright.config.ts, which sets it per project.
 */
export interface ContentEditableOption {
  contenteditable: string;
}
