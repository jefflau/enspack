import { EnspackError } from "@enspack/core";
import type { BootstrapDeps } from "../deps.js";
import type { EntrySnapshot, StepOutcome } from "../types.js";

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * BOOTSTRAP.md §5 step 7 / MVP.md §4.2: `POST /v1/seed { name }` and poll until progress ≥ 1.
 * Failure is recorded and does not undo the publish.
 */
export async function stepSeed(
  snap: EntrySnapshot,
  deps: Pick<BootstrapDeps, "seedNode" | "log">,
  opts: { timeoutMs: number; pollMs: number },
): Promise<StepOutcome> {
  const name = snap.versionName;
  const infohash = snap.infohash;
  if (name === undefined || infohash === undefined) {
    return { outcome: "failed", reason: "seed requires versionName and infohash" };
  }
  try {
    await deps.seedNode.seed(name);
    const deadline = Date.now() + opts.timeoutMs;
    while (Date.now() < deadline) {
      const status = await deps.seedNode.status(infohash);
      if (status.progress >= 1) {
        return { outcome: "ok", data: {} };
      }
      await sleep(opts.pollMs);
    }
    deps.log.warn(`seed timeout for ${name} (${infohash}); publish stands`);
    return { outcome: "ok", data: {} };
  } catch (err) {
    const message = err instanceof EnspackError ? err.message : String(err);
    deps.log.warn(`seed failed for ${name}: ${message}; publish stands`);
    return { outcome: "ok", data: {} };
  }
}
