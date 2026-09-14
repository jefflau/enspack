import { isEnspackError } from "@enspack/core";
import type { BootstrapDeps } from "../deps.js";
import type { EntrySnapshot, StepOutcome } from "../types.js";

/**
 * BOOTSTRAP.md §5 step 9: resolve the published name and require the CID to match.
 * The operator must still run `enspack get <name>` on a different machine before announcing.
 */
export async function stepConfirm(
  snap: EntrySnapshot,
  chain: "mainnet" | "sepolia",
  deps: Pick<BootstrapDeps, "resolver">,
): Promise<StepOutcome> {
  const name = snap.versionName;
  const expected = snap.manifestCid;
  if (name === undefined || expected === undefined) {
    return { outcome: "failed", reason: "confirm requires versionName and manifestCid" };
  }
  try {
    const resolved = await deps.resolver.resolve(name, { chain });
    if (resolved.cid !== expected) {
      return {
        outcome: "failed",
        reason: `resolved CID ${JSON.stringify(resolved.cid)} !== published ${expected}`,
      };
    }
    return { outcome: "ok", data: {} };
  } catch (err) {
    const message = isEnspackError(err) ? err.message : err instanceof Error ? err.message : String(err);
    return { outcome: "failed", reason: `confirm resolve failed: ${message}` };
  }
}
