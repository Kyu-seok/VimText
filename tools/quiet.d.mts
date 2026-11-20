/** Resolves true once the load average is below the core count, false when the cap ran out first. */
export function waitForQuiet(options: {
  cores: number;
  load: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
  capMs?: number;
  everyMs?: number;
}): Promise<boolean>;
