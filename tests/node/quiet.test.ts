import { it, expect } from "vitest";
import { waitForQuiet } from "../../tools/quiet.mjs";

/**
 * `tools/quiet.mjs` holds `npm run test:e2e:editors` back while the machine is
 * busy with something else: in #88 three of five runs had one flaky test each
 * under a load average of 43 to 58, and the run at a load under 2 was clean.
 * The clock and the load are passed in, so no test waits.
 */
function machine(loads: number[]) {
  const logged: string[] = [];
  let slept = 0;
  let at = 0;
  return {
    logged,
    slept: () => slept,
    options: {
      cores: 8,
      load: () => loads[Math.min(at, loads.length - 1)]!,
      sleep: async (ms: number) => {
        slept += ms;
        at++;
      },
      log: (line: string) => logged.push(line),
    },
  };
}

it("starts at once and says nothing when the load average is below the core count", async () => {
  const m = machine([2.3]);
  expect(await waitForQuiet(m.options)).toBe(true);
  expect(m.slept()).toBe(0);
  expect(m.logged).toEqual([]);
});

it("waits while the load average is at or above the core count, and says how long it waited", async () => {
  const m = machine([45.6, 20.1, 8, 7.9]);
  expect(await waitForQuiet(m.options)).toBe(true);
  expect(m.slept()).toBe(15_000);
  expect(m.logged).toEqual([
    "quiet: load average 45.6 on 8 cores; waiting up to 180 s for it to drop below 8",
    "quiet: load average 7.9 after 15 s",
  ]);
});

it("gives up after the cap and says the run may flake for the machine's reasons", async () => {
  const m = machine([50]);
  expect(await waitForQuiet(m.options)).toBe(false);
  expect(m.slept()).toBe(180_000);
  expect(m.logged.at(-1)).toBe(
    "quiet: load average still 50.0 after 180 s; running anyway, and a flaky test in this run may be the machine's",
  );
});
