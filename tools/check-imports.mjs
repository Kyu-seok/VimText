// Engine packages stay behind src/engine/; chrome.* stays in its adapters. See CODING_STANDARDS.md.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const banned = /from\s+["'](@replit\/codemirror-vim|@codemirror\/(view|commands|language|search))["']/;
const problems = [];
const chromeApi = /\bchrome\./;
// The only files under src/ that may touch the extension API; everything else stays
// testable in a plain Chromium page (src/content/ exists for exactly that reason).
const chromeAdapters = new Set([
  "src/content.ts",
  "src/background.ts",
  "src/settings/settings.ts",
  "src/settings/sessionState.ts",
]);
const chromeProblems = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.ts$/.test(name)) {
      const rel = relative(process.cwd(), p);
      if (rel.startsWith("src/engine/")) continue;
      readFileSync(p, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (banned.test(line)) problems.push(`${rel}:${i + 1}: ${line.trim()}`);
          if (rel.startsWith("src/") && !chromeAdapters.has(rel) && chromeApi.test(line))
            chromeProblems.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
  }
}

for (const dir of ["src", "popup", "options", "tests"]) walk(dir);
if (problems.length) {
  console.error("Engine imports outside src/engine/:\n" + problems.join("\n"));
  process.exit(1);
}
if (chromeProblems.length) {
  console.error(
    "chrome.* outside its adapters (" + [...chromeAdapters].join(", ") + "):\n" + chromeProblems.join("\n"),
  );
  process.exit(1);
}
console.log("check-imports: ok");
