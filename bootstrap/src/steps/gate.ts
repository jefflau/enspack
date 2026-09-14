import { EnspackError } from "@enspack/core";
import { licenseGate } from "@enspack/hf";
import type { BootstrapDeps } from "../deps.js";
import { splitRepo } from "../names.js";
import type { ModelEntry, ModelsConfig, StepOutcome } from "../types.js";

/**
 * BOOTSTRAP.md §5 step 1 / §2: gate (not gated, public, license allowlisted and
 * equal to `expected_license`); resolve the full 40-hex revision.
 */
export async function stepGate(
  entry: ModelEntry,
  config: ModelsConfig,
  deps: Pick<BootstrapDeps, "hf">,
): Promise<StepOutcome> {
  const { org, repoName } = splitRepo(entry.repo);
  const info = await deps.hf.info(entry.repo);
  if (info.gated !== false) {
    return { outcome: "skipped", reason: `gated (${JSON.stringify(info.gated)})` };
  }
  if (info.private) {
    return { outcome: "skipped", reason: "private repo" };
  }
  const license = info.license;
  try {
    licenseGate(license, { allowlist: config.licenseAllowlist });
  } catch (err) {
    const message = err instanceof EnspackError ? err.message : String(err);
    return { outcome: "skipped", reason: message };
  }
  if (license !== entry.expected_license) {
    return {
      outcome: "skipped",
      reason: `license ${JSON.stringify(license)} !== expected_license ${JSON.stringify(entry.expected_license)}`,
    };
  }
  const sha = await deps.hf.resolveRevision(entry.repo, entry.revision);
  const short = entry.revision.toLowerCase();
  if (!sha.startsWith(short)) {
    return {
      outcome: "failed",
      reason: `resolved revision ${sha} does not start with yaml revision ${entry.revision}`,
    };
  }
  const tree = await deps.hf.tree(entry.repo, sha);
  const snapshotSize = tree.reduce((sum, f) => sum + (f.lfs?.size ?? f.size), 0);
  return {
    outcome: "ok",
    data: {
      org,
      repoName,
      revision: sha,
      license,
      snapshotSize,
      fileCount: tree.length,
    },
  };
}
