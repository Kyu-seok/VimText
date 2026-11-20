// Prints what the last Playwright run left behind: its counts, and for every test that
// failed or passed only on a retry, each attempt's status, first error line and `machine`
// line (browser launch time and load average, tests/e2e/extension.ts).
//
//   npm run e2e:last
//
// The run's terminal output is often cut (`| tail`) or scrolled away; the JSON reporter in
// playwright.config.ts writes test-results/last-run-report.json at the end of every run, the
// gate's, `npm run test:e2e:editors`' and pre-push's included. Retro of #77: one repeated
// editor run had 12 of 215 tests not passing under a load average near 50, and the two test
// names its last three lines showed were all that was kept.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPORT = "test-results/last-run-report.json";

/** The lines to print for a Playwright JSON report. */
export function summarize(report) {
  const { expected = 0, unexpected = 0, flaky = 0, skipped = 0 } = report.stats ?? {};
  const lines = [`${expected} passed, ${unexpected} failed, ${flaky} flaky, ${skipped} skipped`];
  const visit = (suite, file) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.status !== "unexpected" && test.status !== "flaky") continue;
        lines.push(
          `${test.status === "flaky" ? "flaky" : "failed"}: [${test.projectName}] ${file}:${spec.line} › ${spec.title}`,
        );
        for (const result of test.results ?? []) {
          const error = (result.error?.message ?? "").replace(/\u001b\[[0-9;]*m/g, "").split("\n")[0];
          const machine = (result.attachments ?? []).find((a) => a.name === "machine");
          const state = machine?.body ? Buffer.from(machine.body, "base64").toString("utf8") : "";
          lines.push(
            `  attempt ${result.retry + 1}: ${result.status}${error ? `: ${error}` : ""}${state ? ` (${state})` : ""}`,
          );
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child, child.file ?? file);
  };
  for (const suite of report.suites ?? []) visit(suite, suite.file);
  return lines;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync(REPORT)) {
    console.error(`e2e:last: no ${REPORT}; run an e2e command first`);
    process.exit(2);
  }
  console.log(summarize(JSON.parse(readFileSync(REPORT, "utf8"))).join("\n"));
}
