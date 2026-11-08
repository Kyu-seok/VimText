import { it, expect } from "vitest";
import { readJson, readText } from "./repo";

/**
 * The store summary and the manifest's `description` are the same sentence
 * (spec #27, user stories 3 and 16): the listing holds the sentence the
 * dashboard is given, the manifest holds the one Chrome shows, and this check
 * is what refuses a change to one that is not made to the other. The store
 * caps the summary at 132 characters, so the manifest is held to that too.
 */
const description = () => readJson("manifest.json").description as string;

it("the manifest description is the summary sentence in the store listing", () => {
  const listing = readText("docs/store/listing.md");
  expect(
    listing,
    `docs/store/listing.md does not contain the manifest description "${description()}"`,
  ).toContain(description());
});

it("the manifest description fits the store's 132-character summary", () => {
  expect(description().length).toBeLessThanOrEqual(132);
});
