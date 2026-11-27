// Hunts a flake: runs e2e specs in repeated rounds with no retry, keeping a trace of every
// failure, optionally under CPU load of its own making.
//
//   npm run flake                                             # the pre-push editors mix, 5 rounds
//   npm run flake -- tests/e2e/slate.spec.ts:159 --rounds 3 --repeat-each 100 --stress 6
//
// A round is `playwright test --project=e2e --project="e2e monaco edit-context" <specs> --repeat-each=<n> --workers=<n> --retries=0
// --trace retain-on-failure`, its traces under test-results/flake-<round>/. Each round prints
// its last line, its failures and the machine's load average: a round that was red while the
// load was far above the core count may be the machine, not the test (#83). `--stress K` runs
// K busy loops beside the rounds and stops them on exit, also on Ctrl-C: in #79 six hand-started
// ones were left running and loaded every run after them. Exit 0 when every round is green.
import { spawn, spawnSync } from "node:child_process";
import { loadavg } from "node:os";

const EDITORS = ["slate", "lexical", "quill", "prosemirror", "monaco"].map((e) => `tests/e2e/${e}.spec.ts`);
const options = { rounds: 5, "repeat-each": 5, workers: 4, stress: 0 };
const specs = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const name = args[i].replace(/^--/, "");
  if (args[i].startsWith("--") && name in options && /^\d+$/.test(args[i + 1] ?? ""))
    options[name] = Number(args[++i]);
  else if (!args[i].startsWith("--")) specs.push(args[i]);
  else {
    console.error(
      `flake: unknown or valueless option ${args[i]} (--rounds, --repeat-each, --workers, --stress take a number)`,
    );
    process.exit(2);
  }
}
if (!specs.length) specs.push(...EDITORS);

const busy = [];
const stopBusy = () => busy.splice(0).forEach((p) => p.kill("SIGKILL"));
process.on("exit", stopBusy);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.on(signal, () => {
    stopBusy();
    process.exit(130);
  });

const build = spawnSync("npm", ["run", "build"], { encoding: "utf8" });
if (build.status !== 0) {
  console.error(build.stdout + build.stderr);
  console.error("flake: the build failed");
  process.exit(2);
}
for (let i = 0; i < options.stress; i++)
  busy.push(spawn(process.execPath, ["-e", "for(;;);"], { stdio: "ignore" }));

const load = () => loadavg()[0].toFixed(1);
let red = 0;
for (let round = 1; round <= options.rounds; round++) {
  const before = load();
  const run = spawnSync(
    "npx",
    [
      "playwright",
      "test",
      "--project=e2e",
      // The Monaco specs among them again on Monaco's EditContext input (playwright.config.ts).
      "--project=e2e monaco edit-context",
      ...specs,
      `--repeat-each=${options["repeat-each"]}`,
      `--workers=${options.workers}`,
      "--retries=0",
      "--trace=retain-on-failure",
      `--output=test-results/flake-${round}`,
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const lines = (run.stdout + run.stderr).replace(/\x1b\[[0-9;]*m/g, "").split("\n");
  const failures = lines.filter((l) => /^\s+✘/.test(l));
  const summary = lines
    .filter((l) => /^\s+\d+ (passed|failed|flaky|did not run)/.test(l))
    .map((l) => l.trim());
  if (run.status !== 0) red++;
  console.log(
    `round ${round}: ${run.status === 0 ? "green" : "RED"} (${summary.join(", ") || "no summary"}), load average ${before} → ${load()}`,
  );
  for (const f of failures) console.log(f);
  if (run.status !== 0) console.log(`  traces: test-results/flake-${round}/`);
}
stopBusy();
console.log(red ? `flake: ${red} of ${options.rounds} rounds red` : `flake: ${options.rounds} rounds green`);
process.exit(red ? 1 : 0);
