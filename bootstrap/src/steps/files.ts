import { EnspackError } from "@enspack/core";
import { crossCheck } from "@enspack/hf";
import type { BootstrapDeps } from "../deps.js";
import type { EntrySnapshot, ModelEntry, StepOutcome } from "../types.js";

/**
 * BOOTSTRAP.md §5 step 2 / §2 rule 3: `buildFiles` then Hugging Bay lock cross-check.
 * Disagreement fails the entry; a missing HB artifact is not an error.
 */
export async function stepFiles(
  entry: ModelEntry,
  revision: string,
  deps: Pick<BootstrapDeps, "hf" | "hb">,
): Promise<StepOutcome> {
  const files = await deps.hf.buildFiles(entry.repo, revision);
  const artifact = await deps.hb.resolve(entry.repo);
  if (artifact === null) {
    const data: Partial<EntrySnapshot> = {
      files,
      fileCount: files.length,
      hbCrossCheck: "no-artifact",
    };
    return { outcome: "ok", data };
  }
  try {
    const lock = await deps.hb.lock(artifact.id);
    crossCheck(files, lock);
  } catch (err) {
    const message = err instanceof EnspackError ? err.message : String(err);
    return { outcome: "failed", reason: message };
  }
  const data: Partial<EntrySnapshot> = {
    files,
    fileCount: files.length,
    hbCrossCheck: "ok",
    hbId: artifact.id,
  };
  if (artifact.digest !== undefined) data.hbDigest = artifact.digest;
  return { outcome: "ok", data };
}
