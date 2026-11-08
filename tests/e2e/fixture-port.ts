import { createHash } from "node:crypto";

/**
 * The fixture server's port, derived from the working directory so parallel
 * worktrees never share one server (Playwright reuses a running server on the
 * same port, which would serve another tree's fixtures). `VIMTEXT_E2E_PORT`
 * overrides it.
 */
export const fixturePort =
  process.env.VIMTEXT_E2E_PORT ??
  String(4200 + (parseInt(createHash("sha256").update(process.cwd()).digest("hex").slice(0, 6), 16) % 800));

export const fixtureOrigin = `http://localhost:${fixturePort}`;
