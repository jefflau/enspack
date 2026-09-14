import { mirrorLabel } from "@enspack/core";
import { createTorrent } from "@enspack/torrent";
import type { BootstrapDeps } from "../deps.js";
import { magnetForInfohash } from "../manifest.js";
import type { EntrySnapshot, ModelEntry, ModelsConfig, StepOutcome } from "../types.js";

function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{([a-z_]+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}

/**
 * BOOTSTRAP.md §5 step 5 / SPEC §8 step 2: torrent with HF (+ optional HB) webseeds, no announce.
 */
export async function stepTorrent(
  entry: ModelEntry,
  snap: EntrySnapshot,
  config: ModelsConfig,
  _deps: Pick<BootstrapDeps, "hfWebseed">,
): Promise<StepOutcome> {
  const dir = snap.downloadDir;
  const revision = snap.revision;
  if (dir === undefined || revision === undefined) {
    return { outcome: "failed", reason: "torrent requires downloadDir and revision" };
  }
  const webseeds = [_deps.hfWebseed(entry.repo, revision)];
  if (snap.hbId !== undefined) {
    webseeds.push(
      fillTemplate(config.webseeds.huggingbay, {
        hb_id: snap.hbId,
        repo: entry.repo,
        revision,
      }),
    );
  }
  const name = mirrorLabel(snap.org, snap.repoName);
  const result = await createTorrent(dir, { name, webseeds, announce: [] });
  const displayName = snap.repoName;
  const magnet = magnetForInfohash(result.infohash, displayName);
  return {
    outcome: "ok",
    data: {
      infohash: result.infohash,
      magnet,
      webseeds,
      torrentB64: Buffer.from(result.metainfo).toString("base64"),
    },
  };
}
