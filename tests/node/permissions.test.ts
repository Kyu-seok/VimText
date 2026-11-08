import { it, expect } from "vitest";
import { readJson, readText } from "./repo";

/**
 * Adding a permission must not silently leave the store texts stale (spec #27,
 * user story 15): every permission the manifest asks for, and every host match
 * its content script runs on, is named in the privacy policy and in the
 * listing's justifications section, the one the store dashboard asks for. The
 * tokens are derived from the manifest, so a new entry there is looked for by
 * its own name: the literal permission name (`storage`, `clipboardRead`) and
 * the literal match pattern (`http://*` followed by `/*`, as the manifest spells it).
 */
interface Manifest {
  permissions?: string[];
  content_scripts?: { matches: string[] }[];
}

const JUSTIFICATIONS_HEADING = "## Permission justifications";

/** The names the texts must contain: every permission and every content script match pattern, as the manifest spells them. */
function manifestTokens(manifest: Manifest): string[] {
  return [
    ...(manifest.permissions ?? []),
    ...(manifest.content_scripts ?? []).flatMap((script) => script.matches),
  ];
}

function justificationsSection(listing: string): string {
  const start = listing.indexOf(JUSTIFICATIONS_HEADING);
  if (start < 0) return "";
  const body = listing.slice(start + JUSTIFICATIONS_HEADING.length);
  const next = body.search(/^## /m);
  return next < 0 ? body : body.slice(0, next);
}

/** The manifest tokens absent from one of the two texts, each named with the text it is missing from. */
function missingMentions(manifest: Manifest, privacy: string, listing: string): string[] {
  const justifications = justificationsSection(listing);
  return manifestTokens(manifest).flatMap((token) => [
    ...(privacy.includes(token) ? [] : [`${token} is not named in PRIVACY.md`]),
    ...(justifications.includes(token)
      ? []
      : [`${token} is not named under "${JUSTIFICATIONS_HEADING}" in the listing`]),
  ]);
}

const manifest = () => readJson("manifest.json") as Manifest;
const privacy = () => readText("PRIVACY.md");
const listing = () => readText("docs/store/listing.md");

it("every manifest permission and host match is named in PRIVACY.md and in the listing's justifications", () => {
  expect(missingMentions(manifest(), privacy(), listing())).toEqual([]);
});

/**
 * Proof that the check can go red: a manifest asking for one more permission
 * than the texts justify is reported, once per text, by that permission's name.
 */
it("a permission added to the manifest and not to the texts is reported for both texts", () => {
  const widened: Manifest = { ...manifest(), permissions: [...(manifest().permissions ?? []), "tabs"] };
  expect(missingMentions(widened, privacy(), listing())).toEqual([
    "tabs is not named in PRIVACY.md",
    `tabs is not named under "${JUSTIFICATIONS_HEADING}" in the listing`,
  ]);
});

it("a listing without a justifications section justifies nothing", () => {
  const withoutSection = listing().replace(JUSTIFICATIONS_HEADING, "## Permissions");
  expect(missingMentions(manifest(), privacy(), withoutSection)).toHaveLength(
    manifestTokens(manifest()).length,
  );
});
