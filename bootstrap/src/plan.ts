import {
  type PublishCall,
  type PublishResult,
  canonicalJson,
  formatPublishPlan,
  manifestCid,
  validateManifest,
} from "@enspack/core";
import { PLACEHOLDER_CID, PLACEHOLDER_INFOHASH, PLACEHOLDER_MAGNET } from "./constants.js";
import type { BootstrapDeps } from "./deps.js";
import { assembleManifest } from "./manifest.js";
import { bumpMinor, modelNameFor } from "./names.js";
import { stepFiles } from "./steps/files.js";
import { stepGate } from "./steps/gate.js";
import type { HbCrossCheckStatus, ModelEntry, ModelsConfig } from "./types.js";

export interface PlanEntryJson {
  repo: string;
  status: "ok" | "skipped" | "failed";
  snapshotSize?: number;
  fileCount?: number;
  license?: string;
  hbCrossCheck?: HbCrossCheckStatus;
  gasEstimate?: string;
  reason?: string;
  version?: string;
  name?: string;
  plan?: string;
}

export interface PlanJson {
  entries: PlanEntryJson[];
  totals: { bytes: number; gasEstimate: string };
}

function callKey(call: PublishCall): string {
  return `${call.to}:${call.data}:${call.description}`;
}

function setupCalls(result: PublishResult): PublishCall[] {
  if ("setup" in result && Array.isArray((result as { setup?: PublishCall[] }).setup)) {
    return (result as { setup: PublishCall[] }).setup;
  }
  return [];
}

function allPublishCalls(result: PublishResult): PublishCall[] {
  const setup = setupCalls(result);
  const keys = new Set(result.calls.map(callKey));
  const extra = setup.filter((call) => !keys.has(callKey(call)));
  return [...result.calls, ...extra];
}

function sumGas(calls: PublishCall[]): bigint {
  let total = 0n;
  for (const call of calls) {
    if (call.gas !== undefined) total += call.gas;
  }
  return total;
}

/**
 * BOOTSTRAP.md §5 / MVP.md WP-12: dry run — steps 1–2 plus `publish({ dryRun: true })` gas.
 */
export async function planBootstrap(
  config: ModelsConfig,
  entries: ModelEntry[],
  chain: "mainnet" | "sepolia",
  deps: BootstrapDeps,
): Promise<PlanJson> {
  const out: PlanEntryJson[] = [];
  let totalBytes = 0;
  let totalGas = 0n;

  for (const entry of entries) {
    const gate = await stepGate(entry, config, deps);
    if (gate.outcome !== "ok") {
      out.push({ repo: entry.repo, status: gate.outcome, reason: gate.reason });
      continue;
    }
    const revision = gate.data.revision;
    const license = gate.data.license;
    const snapshotSize = gate.data.snapshotSize ?? 0;
    if (revision === undefined || license === undefined || gate.data.org === undefined) {
      out.push({ repo: entry.repo, status: "failed", reason: "gate incomplete" });
      continue;
    }
    const filesResult = await stepFiles(entry, revision, deps);
    if (filesResult.outcome !== "ok") {
      out.push({
        repo: entry.repo,
        status: "failed",
        snapshotSize,
        license,
        hbCrossCheck: "failed",
        reason: filesResult.reason,
      });
      continue;
    }
    const files = filesResult.data.files;
    if (files === undefined) {
      out.push({ repo: entry.repo, status: "failed", reason: "buildFiles returned no files" });
      continue;
    }

    const modelName = modelNameFor(gate.data.org, gate.data.repoName ?? "");
    let version = "1.0.0";
    try {
      const resolved = await deps.resolver.resolve(modelName, { chain });
      if (resolved.manifest !== null) {
        const last = resolved.manifest.versions[resolved.manifest.versions.length - 1];
        version = bumpMinor(last?.version ?? resolved.manifest.version);
      }
    } catch {
      /* first publish */
    }

    const webseeds = [deps.hfWebseed(entry.repo, revision)];
    if (filesResult.data.hbId !== undefined) {
      webseeds.push(
        config.webseeds.huggingbay
          .replace("{hb_id}", filesResult.data.hbId)
          .replace("{repo}", entry.repo)
          .replace("{revision}", revision),
      );
    }

    const assemble: Parameters<typeof assembleManifest>[0] = {
      org: gate.data.org,
      repoName: gate.data.repoName ?? "",
      repo: entry.repo,
      revision,
      license,
      displayName: gate.data.repoName ?? entry.repo,
      files,
      infohash: PLACEHOLDER_INFOHASH,
      magnet: PLACEHOLDER_MAGNET,
      torrentCid: PLACEHOLDER_CID,
      webseeds,
      version,
      createdAt: deps.now(),
    };
    const manifest = assembleManifest(assemble);
    validateManifest(manifest);
    const cid = await manifestCid(canonicalJson(manifest));
    const published = await deps.publisher.publish({
      manifest,
      manifestCid: cid,
      chain,
      dryRun: true,
    });
    const calls = allPublishCalls(published);
    const gas = sumGas(calls);
    totalBytes += snapshotSize;
    totalGas += gas;
    const row: PlanEntryJson = {
      repo: entry.repo,
      status: "ok",
      snapshotSize,
      fileCount: files.length,
      license,
      gasEstimate: gas.toString(),
      version,
      name: manifest.name,
      plan: formatPublishPlan(calls),
    };
    if (filesResult.data.hbCrossCheck !== undefined) {
      row.hbCrossCheck = filesResult.data.hbCrossCheck;
    }
    out.push(row);
  }

  return { entries: out, totals: { bytes: totalBytes, gasEstimate: totalGas.toString() } };
}
