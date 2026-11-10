import { it, expect } from "vitest";
import { readText } from "./repo";

/**
 * The release notes are the annotated tag's message (docs/release.md, step 3),
 * and a tag message cannot change once pushed. A placeholder token such as
 * `<CHROME-WEB-STORE-URL>` in them would ship unfilled in the tag and the
 * GitHub Release: the 0.3.0 notes held one until just before tagging (#36).
 * The notes are the first `text` block under the "1. Release notes" heading of
 * docs/store/announcements.md.
 */
function releaseNotes(): string {
  const doc = readText("docs/store/announcements.md");
  const section = doc.slice(doc.indexOf("## 1. Release notes"));
  const block = /```text\n([\s\S]*?)\n```/.exec(section);
  if (!block) throw new Error('docs/store/announcements.md has no ```text block under "## 1. Release notes"');
  return block[1]!;
}

it("the release notes hold no placeholder token, since the tag message cannot change after tagging", () => {
  const tokens = releaseNotes().match(/<[A-Z][A-Z0-9-]*>/g) ?? [];
  expect(tokens, "placeholder tokens in the release notes (docs/store/announcements.md, section 1)").toEqual(
    [],
  );
});
