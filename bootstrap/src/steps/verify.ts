import { EnspackError } from "@enspack/core";
import { PLACEHOLDER_INFOHASH } from "../constants.js";
import type { BootstrapDeps } from "../deps.js";
import { draftManifestForDownload } from "../manifest.js";
import { modelNameFor, versionNameFor } from "../names.js";
import type { EntrySnapshot, StepOutcome } from "../types.js";

/**
 * BOOTSTRAP.md §5 step 4: re-hash every file locally; any failure quarantines the dir.
 */
export async function stepVerify(
  snap: EntrySnapshot,
  deps: Pick<BootstrapDeps, "verifier">,
): Promise<StepOutcome> {
  const files = snap.files;
  const dir = snap.downloadDir;
  if (files === undefined || dir === undefined) {
    return { outcome: "failed", reason: "verify requires files[] and downloadDir" };
  }
  const model = modelNameFor(snap.org, snap.repoName);
  const name = versionNameFor("0.0.0", snap.org, snap.repoName);
  const draft = draftManifestForDownload(files, snap.webseeds ?? [], name, model);
  const result = await deps.verifier.verify(draft, dir);
  if (result.ok) {
    return { outcome: "ok", data: {} };
  }
  const infohash = snap.infohash ?? PLACEHOLDER_INFOHASH;
  let quarantined: string;
  try {
    quarantined = await deps.verifier.quarantine(dir, infohash, result.failures);
  } catch (err) {
    throw new EnspackError("VERIFY", "quarantine failed", err);
  }
  const paths = result.failures.map((f) => `${f.path} (${f.reason})`).join(", ");
  return {
    outcome: "failed",
    reason: `local hash mismatch: ${paths}; quarantined ${quarantined}`,
  };
}
