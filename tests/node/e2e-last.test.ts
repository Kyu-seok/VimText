import { it, expect } from "vitest";
import { summarize } from "../../tools/e2e-last.mjs";

/**
 * `npm run e2e:last` reads the JSON report the last Playwright run wrote and
 * names each test that failed or passed only on a retry, with every attempt's
 * first error line and `machine` line. The shape below is the JSON reporter's.
 */
it("names a failed and a flaky test with each attempt's error and machine line, and leaves a passed one out", () => {
  const machine = (text: string) => [{ name: "machine", body: Buffer.from(text).toString("base64") }];
  const attempt = (retry: number, status: string, message?: string, state?: string) => ({
    retry,
    status,
    ...(message ? { error: { message } } : {}),
    attachments: state ? machine(state) : [],
  });
  const test = (status: string, results: unknown[]) => ({ projectName: "e2e", status, results });
  const report = {
    stats: { expected: 1, unexpected: 1, flaky: 1, skipped: 0 },
    suites: [
      {
        file: "slate.spec.ts",
        specs: [{ title: "passes", line: 3, tests: [test("expected", [attempt(0, "passed")])] }],
        suites: [
          {
            specs: [
              {
                title: "x keeps it bold",
                line: 49,
                tests: [
                  test("unexpected", [
                    attempt(
                      0,
                      "timedOut",
                      "\u001b[31mTest timeout of 30000ms exceeded.\u001b[39m\nmore",
                      "launch 21000 ms, load average 50.4",
                    ),
                    attempt(1, "failed", "expect(received).toBe(expected)"),
                  ]),
                ],
              },
              {
                title: "u restores",
                line: 80,
                tests: [test("flaky", [attempt(0, "failed", "boom"), attempt(1, "passed")])],
              },
            ],
          },
        ],
      },
    ],
  };
  expect(summarize(report)).toEqual([
    "1 passed, 1 failed, 1 flaky, 0 skipped",
    "failed: [e2e] slate.spec.ts:49 › x keeps it bold",
    "  attempt 1: timedOut: Test timeout of 30000ms exceeded. (launch 21000 ms, load average 50.4)",
    "  attempt 2: failed: expect(received).toBe(expected)",
    "flaky: [e2e] slate.spec.ts:80 › u restores",
    "  attempt 1: failed: boom",
    "  attempt 2: passed",
  ]);
});

it("says first when the run it reports started, how long it took and on how many workers", () => {
  const report = {
    config: { workers: 4 },
    stats: {
      startTime: "2026-11-20T12:20:42.738Z",
      duration: 125652.4,
      expected: 235,
      unexpected: 0,
      flaky: 0,
      skipped: 0,
    },
  };
  expect(summarize(report, Date.parse("2026-11-20T12:36:10Z"))).toEqual([
    "run started 15 min ago (2026-11-20T12:20:42.738Z), took 2.1 min on 4 workers",
    "235 passed, 0 failed, 0 flaky, 0 skipped",
  ]);
  // The gate's run: one worker.
  expect(summarize({ ...report, config: { workers: 1 } }, Date.parse("2026-11-20T12:36:10Z"))[0]).toBe(
    "run started 15 min ago (2026-11-20T12:20:42.738Z), took 2.1 min on 1 worker",
  );
});

it("says what the machine was like as the run started, when the report recorded it", () => {
  const report = {
    config: { workers: 4, metadata: { machineAtStart: "load average 32.5 on 8 cores, free memory 90 MB" } },
    stats: {
      startTime: "2026-11-20T12:20:42.738Z",
      duration: 125652.4,
      expected: 1,
      unexpected: 0,
      flaky: 0,
      skipped: 0,
    },
  };
  expect(summarize(report, Date.parse("2026-11-20T12:36:10Z"))).toEqual([
    "run started 15 min ago (2026-11-20T12:20:42.738Z), took 2.1 min on 4 workers",
    "as it started: load average 32.5 on 8 cores, free memory 90 MB",
    "1 passed, 0 failed, 0 flaky, 0 skipped",
  ]);
});

/**
 * A timeout's own error names only the test or the hook. The reporter lists
 * after it the call the timeout interrupted, with its place in the spec:
 * implementing #90, two `beforeEach` timeouts could not be told apart as a
 * page that never loaded or an Activation that never showed NORMAL.
 */
it("names under an attempt the call its timeout interrupted, with the line it was made on", () => {
  const timeout = 'Test timeout of 30000ms exceeded while running "beforeEach" hook.';
  const report = {
    stats: { expected: 0, unexpected: 0, flaky: 1, skipped: 0 },
    suites: [
      {
        file: "lexical.spec.ts",
        specs: [
          {
            title: "dw deletes a bold word",
            line: 98,
            tests: [
              {
                projectName: "e2e",
                status: "flaky",
                results: [
                  {
                    retry: 0,
                    status: "timedOut",
                    error: { message: timeout },
                    errors: [
                      { message: `${timeout}\n\n  44 | test.beforeEach(` },
                      {
                        message:
                          "Error: page.waitForSelector: Target page, context or browser has been closed\nCall log:\n  - waiting",
                        location: { file: "/repo/tests/e2e/extension.ts", line: 85, column: 15 },
                      },
                    ],
                  },
                  { retry: 1, status: "passed", errors: [] },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  expect(summarize(report)).toEqual([
    "0 passed, 0 failed, 1 flaky, 0 skipped",
    "flaky: [e2e] lexical.spec.ts:98 › dw deletes a bold word",
    `  attempt 1: timedOut: ${timeout}`,
    "    then: Error: page.waitForSelector: Target page, context or browser has been closed (extension.ts:85)",
    "  attempt 2: passed",
  ]);
});
