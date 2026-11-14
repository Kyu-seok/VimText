import { it, expect } from "vitest";
import { readText } from "./repo";

/**
 * docs/engine-seams.md merges with `merge=union` (.gitattributes), so an entry
 * two branches both edited lands twice, old and new, with no conflict: a merge
 * in #75 did that silently. An entry is a list item led by a bold name
 * (`- **Feeding keys** (...)`); each name appears once in the file.
 */
function repeatedEntries(doc: string): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const [, name] of doc.matchAll(/^- \*\*(.+?)\*\*/gm)) {
    if (seen.has(name!)) repeated.add(name!);
    seen.add(name!);
  }
  return [...repeated];
}

it("finds an entry name a union merge wrote twice", () => {
  const fixture = [
    "- **Feeding keys** (adapter `handleKey`): old wording.",
    "- **Key names** (engine `vimKeyFromEvent`): fine.",
    "- **Feeding keys** (adapter `handleKey`): new wording.",
  ].join("\n");
  expect(repeatedEntries(fixture)).toEqual(["Feeding keys"]);
});

it("docs/engine-seams.md names each entry once, so a union merge's old copy of an edited entry is caught", () => {
  expect(
    repeatedEntries(readText("docs/engine-seams.md")),
    "entries repeated in docs/engine-seams.md",
  ).toEqual([]);
});
