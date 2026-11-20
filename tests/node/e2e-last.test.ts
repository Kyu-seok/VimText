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
});
