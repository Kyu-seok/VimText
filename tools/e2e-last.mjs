// Prints what the last Playwright run left behind: its counts, and for every test that
// failed or passed only on a retry, each attempt's status, first error line and `machine`
// line (browser launch time, load average and free memory, tests/e2e/extension.ts), and
// under it the errors the reporter lists after the first: for a timeout, the call it
// interrupted and the line that made it.
//
//   npm run e2e:last
//   node tools/e2e-last.mjs --clear    (the gate's first step: removes the report)
//
// The run's terminal output is often cut (`| tail`) or scrolled away; the JSON reporter in
// playwright.config.ts writes test-results/last-run-report.json at the end of every run, the
// gate's, `npm run test:e2e:editors`' and pre-push's included. Retro of #77: one repeated
// editor run had 12 of 215 tests not passing under a load average near 50, and the two test
// names its last three lines showed were all that was kept.
//
// The first line says which run the report is of: when it started, how long it took and on
// how many workers (the gate runs one, the editors' repeated run four). Implementing #88, a
// gate that stopped at the unit tests left the report of the `red-on-main` run before it, and
// its 13 failures read as the gate's. So the gate removes the report before it starts: one
// that never reaches e2e leaves none.
//
// The second line is the machine as the run started (playwright.config.ts `metadata`): the
// `machine` line of a failure is read mid-run, when the run's own four workers are part of
// the load. Implementing #90, two editors' runs each had a `beforeEach` timeout, and nothing
// kept said whether they had started on a busy machine after tools/quiet.mjs gave up waiting.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPORT = "test-results/last-run-report.json";

/** An error message's first line, without the terminal colours. */
const firstLine = (message) => (message ?? "").replace(/\u001b\[[0-9;]*m/g, "").split("\n")[0];

/** The lines to print for a Playwright JSON report, read at `now` (ms since the epoch). */
export function summarize(report, now = Date.now()) {
  const { expected = 0, unexpected = 0, flaky = 0, skipped = 0, startTime, duration } = report.stats ?? {};
  const lines = [];
  if (startTime) {
    const ago = Math.round((now - Date.parse(startTime)) / 60_000);
    const took = ((duration ?? 0) / 60_000).toFixed(1);
    const workers = report.config?.workers;
    lines.push(
      `run started ${ago} min ago (${startTime}), took ${took} min${workers ? ` on ${workers} worker${workers === 1 ? "" : "s"}` : ""}`,
    );
  }
  const atStart = report.config?.metadata?.machineAtStart;
  if (atStart) lines.push(`as it started: ${atStart}`);
  lines.push(`${expected} passed, ${unexpected} failed, ${flaky} flaky, ${skipped} skipped`);
  const visit = (suite, file) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.status !== "unexpected" && test.status !== "flaky") continue;
        lines.push(
          `${test.status === "flaky" ? "flaky" : "failed"}: [${test.projectName}] ${file}:${spec.line} › ${spec.title}`,
        );
        for (const result of test.results ?? []) {
          const error = firstLine(result.error?.message);
          const machine = (result.attachments ?? []).find((a) => a.name === "machine");
          const state = machine?.body ? Buffer.from(machine.body, "base64").toString("utf8") : "";
          lines.push(
            `  attempt ${result.retry + 1}: ${result.status}${error ? `: ${error}` : ""}${state ? ` (${state})` : ""}`,
          );
          // The errors after the first: for a timeout, the call it interrupted.
          for (const later of (result.errors ?? []).slice(1)) {
            const at = later.location
              ? ` (${later.location.file.split("/").pop()}:${later.location.line})`
              : "";
            lines.push(`    then: ${firstLine(later.message)}${at}`);
          }
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child, child.file ?? file);
  };
  for (const suite of report.suites ?? []) visit(suite, suite.file);
  return lines;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--clear")) {
    rmSync(REPORT, { force: true });
    process.exit(0);
  }
  if (!existsSync(REPORT)) {
    console.error(`e2e:last: no ${REPORT}; run an e2e command first`);
    process.exit(2);
  }
  console.log(summarize(JSON.parse(readFileSync(REPORT, "utf8"))).join("\n"));
}
