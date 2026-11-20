// Waits for a quiet machine before a timing-sensitive e2e run.
//
//   node tools/quiet.mjs        (`npm run test:e2e:editors` runs it before Playwright)
//
// The repeated rich-editor run is four workers against editors that render late; under a
// load average far above the core count it flakes for the machine's reasons. Implementing
// #88, three of five runs had one flaky test each (two `beforeEach` timeouts, one content
// mismatch) under a load average of 43 to 58 from other processes, and the run pre-push
// made at a load under 2 was clean. The `machine` line a failure prints names the load only
// afterwards (#79, #83); this holds the run back first.
//
// It waits while the one-minute load average is at or above the core count, up to three
// minutes, then runs anyway and says so: a push must not hang on a machine that stays busy.
// The exit code is always 0.
import { cpus, loadavg } from "node:os";
import { fileURLToPath } from "node:url";

/** Resolves true once the load average is below the core count, false when the cap ran out first. */
export async function waitForQuiet({ cores, load, sleep, log, capMs = 180_000, everyMs = 5_000 }) {
  if (load() < cores) return true;
  log(
    `quiet: load average ${load().toFixed(1)} on ${cores} cores; waiting up to ${capMs / 1000} s for it to drop below ${cores}`,
  );
  for (let waited = everyMs; waited <= capMs; waited += everyMs) {
    await sleep(everyMs);
    if (load() < cores) {
      log(`quiet: load average ${load().toFixed(1)} after ${waited / 1000} s`);
      return true;
    }
  }
  log(
    `quiet: load average still ${load().toFixed(1)} after ${capMs / 1000} s; running anyway, and a flaky test in this run may be the machine's`,
  );
  return false;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await waitForQuiet({
    cores: cpus().length,
    load: () => loadavg()[0],
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (line) => console.log(line),
  });
}
