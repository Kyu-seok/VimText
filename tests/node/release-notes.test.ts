import { existsSync } from "node:fs";
import { it, expect } from "vitest";
import { readJson, readText, repoPath } from "./repo";

/**
 * The release notes are the annotated tag's message (docs/release.md, step 3),
 * and a tag message cannot change once pushed. Each version's notes are a file,
 * `docs/release-notes/<version>.txt`, that the tag is cut from with `-F`, so
 * the text checked here is the text that ships: the 0.4.1 notes existed only
 * in their tag, and the check read the 0.4.0 draft (#96's retro).
 *
 * A placeholder token such as `<CHROME-WEB-STORE-URL>` in them would ship
 * unfilled in the tag and the GitHub Release: the 0.3.0 notes held one until
 * just before tagging (#36).
 */
const version = String(readJson("manifest.json").version);
const notesFile = `docs/release-notes/${version}.txt`;

it("the manifest's version has its release notes, titled with that version", () => {
  expect(existsSync(repoPath(notesFile)), `${notesFile} is missing: the bump adds it (docs/release.md)`).toBe(
    true,
  );
  const title = readText(notesFile).split("\n")[0]!;
  expect(title, `the first line of ${notesFile} is the Release's title`).toMatch(
    new RegExp(`^VimText ${version.replaceAll(".", "\\.")}(: .+)?$`),
  );
});

it("the release notes hold no placeholder token, since the tag message cannot change after tagging", () => {
  const tokens = readText(notesFile).match(/<[A-Z][A-Z0-9-]*>/g) ?? [];
  expect(tokens, `placeholder tokens in ${notesFile}`).toEqual([]);
});
