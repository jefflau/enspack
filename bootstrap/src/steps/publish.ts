import type { BootstrapDeps } from "../deps.js";
import type { EntrySnapshot, StepOutcome } from "../types.js";

/**
 * BOOTSTRAP.md §5 step 6 / SPEC §8 step 5: `createPublisher().publish` under `mirrors.enspack.eth`.
 */
export async function stepPublish(
  snap: EntrySnapshot,
  chain: "mainnet" | "sepolia",
  deps: Pick<BootstrapDeps, "publisher">,
): Promise<StepOutcome> {
  const manifest = snap.manifest;
  const manifestCid = snap.manifestCid;
  if (manifest === undefined || manifestCid === undefined) {
    return { outcome: "failed", reason: "publish requires assembled manifest and CID" };
  }
  const result = await deps.publisher.publish({
    manifest,
    manifestCid,
    chain,
  });
  return {
    outcome: "ok",
    data: { txs: [...result.txs], versionName: result.name, modelName: result.model, manifestCid },
  };
}
