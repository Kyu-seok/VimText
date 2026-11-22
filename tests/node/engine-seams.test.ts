import { it, expect } from "vitest";
import { existsSync } from "node:fs";
import { readText, repoPath } from "./repo";

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

/**
 * An entry's "Pinned by" sentence names test files and, in double quotes, the
 * `describe` or test names that pin it (CODING_STANDARDS rule 12). A name no
 * named file contains is a pin that does not exist: in #77 an entry stated a
 * browser fact nothing had probed, and the probe then showed it false. A
 * quoted name may be the start of a title, or end in "…". This checks the pin
 * an entry names; a sentence with no pin stays the reviewer's to find.
 */
function brokenPins(doc: string, read: (file: string) => string | null): string[] {
  const broken: string[] = [];
  for (const [, entry, body] of doc.matchAll(/^- \*\*(.+?)\*\*(.*)$/gm)) {
    const at = body!.indexOf("Pinned by");
    if (at < 0) continue;
    const clause = body!.slice(at);
    let source = "";
    for (const [, file] of clause.matchAll(/`(tests\/[^`]+\.ts)`/g)) {
      const text = read(file!);
      if (text === null) broken.push(`${entry}: no file ${file}`);
      else source += text;
    }
    for (const [, name] of clause.matchAll(/"([^"]+)"/g)) {
      if (!source.includes(name!.replace(/…$/, ""))) broken.push(`${entry}: no test "${name}"`);
    }
  }
  return broken;
}

it("finds a pin that names a missing file or a test no named file has", () => {
  const fixture = [
    '- **Top layer** (`place`): a fact. Pinned by `tests/unit/facts.test.ts`, "Top layer" and "hiding hands focus back".',
    '- **Key names** (engine): a fact. Pinned by `tests/unit/gone.test.ts`, "a name that starts a title…".',
    "- **Layout** (adapter): a gotcha with no pin.",
  ].join("\n");
  const files: Record<string, string> = { "tests/unit/facts.test.ts": 'describe("Top layer", () => {});' };
  expect(brokenPins(fixture, (f) => files[f] ?? null)).toEqual([
    'Top layer: no test "hiding hands focus back"',
    "Key names: no file tests/unit/gone.test.ts",
    'Key names: no test "a name that starts a title…"',
  ]);
});

it("every pin docs/engine-seams.md names exists: the file, and each quoted name in one of the entry's files", () => {
  const read = (file: string) => (existsSync(repoPath(file)) ? readText(file) : null);
  expect(
    brokenPins(readText("docs/engine-seams.md"), read),
    'pins that do not exist (a quoted name stands word for word in one of the entry\'s named files; cut it short only at its end, with "…")',
  ).toEqual([]);
});
