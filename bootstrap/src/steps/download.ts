import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { BootstrapDeps } from "../deps.js";
import { draftManifestForDownload } from "../manifest.js";
import { downloadDirName, modelNameFor, versionNameFor } from "../names.js";
import type { EntrySnapshot, ModelEntry, StepOutcome } from "../types.js";

/**
 * BOOTSTRAP.md §5 step 3: download the snapshot with aria2c `httpOnly` + HF webseed.
 */
export async function stepDownload(
  entry: ModelEntry,
  snap: EntrySnapshot,
  downloads: string,
  deps: Pick<BootstrapDeps, "downloader" | "hfWebseed" | "downloadWebseeds" | "log">,
): Promise<StepOutcome> {
  const files = snap.files;
  const revision = snap.revision;
  if (files === undefined || files.length === 0 || revision === undefined) {
    return { outcome: "failed", reason: "download requires files[] and revision from prior steps" };
  }
  const dest = join(downloads, downloadDirName(snap.org, snap.repoName));
  await mkdir(dest, { recursive: true });
  const webseeds =
    deps.downloadWebseeds !== undefined
      ? deps.downloadWebseeds(entry.repo, revision)
      : [deps.hfWebseed(entry.repo, revision)];
  const model = modelNameFor(snap.org, snap.repoName);
  const name = versionNameFor("0.0.0", snap.org, snap.repoName);
  const draft = draftManifestForDownload(files, webseeds, name, model);
  await deps.downloader.fetch(draft, dest, {
    httpOnly: true,
    webseeds,
    onProgress: (p) => {
      deps.log.info(
        `download ${entry.repo} ${p.bytesDone}/${p.bytesTotal}${p.path !== undefined ? ` ${p.path}` : ""}`,
      );
    },
  });
  return { outcome: "ok", data: { downloadDir: dest, webseeds } };
}
