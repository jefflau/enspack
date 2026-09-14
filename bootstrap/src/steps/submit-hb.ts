import { EnspackError, MAGNET_RE } from "@enspack/core";
import type { BootstrapDeps } from "../deps.js";
import type { EntrySnapshot, ModelEntry, StepOutcome } from "../types.js";

/**
 * BOOTSTRAP.md §5 step 8 / SPEC §8 step 6: optional Hugging Bay fallback. Best-effort.
 * Observed API requires `sourceUrl` + `filePath` in addition to magnet/infohash.
 */
export async function stepSubmitHb(
  entry: ModelEntry,
  snap: EntrySnapshot,
  deps: Pick<BootstrapDeps, "hb" | "hfWebseed" | "log">,
): Promise<StepOutcome> {
  const artifactId = snap.hbId;
  const magnet = snap.magnet;
  const infohash = snap.infohash;
  const revision = snap.revision;
  const files = snap.files;
  if (artifactId === undefined) {
    deps.log.warn(`--submit-hb skipped for ${entry.repo}: no Hugging Bay artifact`);
    return { outcome: "ok", data: {} };
  }
  if (magnet === undefined || infohash === undefined || revision === undefined || files === undefined) {
    deps.log.warn(`--submit-hb skipped for ${entry.repo}: missing magnet/files`);
    return { outcome: "ok", data: {} };
  }
  if (!MAGNET_RE.test(magnet)) {
    deps.log.warn(`--submit-hb skipped for ${entry.repo}: magnet fails MAGNET_RE`);
    return { outcome: "ok", data: {} };
  }
  const sourceUrl = deps.hfWebseed(entry.repo, revision);
  const displayName = `enspack: ${snap.versionName ?? snap.repoName}`;
  try {
    for (const file of files) {
      await deps.hb.submitFallback(artifactId, {
        magnet,
        displayName,
        infohash,
        sourceUrl,
        filePath: file.path,
      });
    }
    return { outcome: "ok", data: {} };
  } catch (err) {
    const message = err instanceof EnspackError ? err.message : String(err);
    deps.log.warn(`Hugging Bay fallback failed for ${entry.repo}: ${message}`);
    return { outcome: "ok", data: {} };
  }
}
