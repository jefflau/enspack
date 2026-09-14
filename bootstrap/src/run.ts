import type { BootstrapDeps, RunOptions } from "./deps.js";
import { markStepOk, markStepStart, newEntryRecord, readState, writeState } from "./state.js";
import { stepConfirm } from "./steps/confirm.js";
import { stepDownload } from "./steps/download.js";
import { stepFiles } from "./steps/files.js";
import { stepGate } from "./steps/gate.js";
import { stepPin } from "./steps/pin.js";
import { stepPublish } from "./steps/publish.js";
import { stepSeed } from "./steps/seed.js";
import { stepSubmitHb } from "./steps/submit-hb.js";
import { stepTorrent } from "./steps/torrent.js";
import { stepVerify } from "./steps/verify.js";
import { STEP_NAMES, type EntryRecord, type StepName, type StepOutcome } from "./types.js";

async function runOneStep(
  step: StepName,
  entry: RunOptions["entries"][number],
  record: EntryRecord,
  opts: RunOptions,
  deps: BootstrapDeps,
): Promise<StepOutcome> {
  const snap = record.snapshot;
  switch (step) {
    case "gate":
      return stepGate(entry, opts.config, deps);
    case "files":
      if (snap.revision === undefined) return { outcome: "failed", reason: "missing revision" };
      return stepFiles(entry, snap.revision, deps);
    case "download":
      return stepDownload(entry, snap, opts.downloads, deps);
    case "verify":
      return stepVerify(snap, deps);
    case "torrent":
      return stepTorrent(entry, snap, opts.config, deps);
    case "pin":
      return stepPin(entry, snap, deps, opts.chain);
    case "publish":
      return stepPublish(snap, opts.chain, deps);
    case "seed":
      return stepSeed(snap, deps, {
        timeoutMs: opts.seedTimeoutMs ?? 120_000,
        pollMs: opts.seedPollMs ?? 1_000,
      });
    case "submit-hb":
      return stepSubmitHb(entry, snap, deps);
    case "confirm":
      return stepConfirm(snap, opts.chain, deps);
  }
}

/**
 * BOOTSTRAP.md §5: run the resumable per-entry pipeline. Re-runs skip `done` entries.
 */
export async function runBootstrap(opts: RunOptions, deps: BootstrapDeps): Promise<EntryRecord[]> {
  const state = await readState(opts.statePath);
  const results: EntryRecord[] = [];

  for (const entry of opts.entries) {
    let record = state.entries[entry.repo];
    if (record?.status === "done") {
      deps.log.info(`skip ${entry.repo} (done)`);
      results.push(record);
      continue;
    }
    if (record?.status === "skipped") {
      deps.log.info(`skip ${entry.repo} (skipped: ${record.reason ?? ""})`);
      results.push(record);
      continue;
    }

    const now = deps.now();
    if (record === undefined || !opts.resume) {
      const { org, repoName } = splitFromEntry(entry.repo, record);
      record = newEntryRecord(entry.repo, { org, repoName }, now);
    }
    record.status = "in-progress";
    const completed = new Set(opts.resume ? record.completedSteps : []);
    if (!opts.resume) {
      record.completedSteps = [];
      record.outputs = {};
      const { org, repoName } = splitFromEntry(entry.repo, record);
      record.snapshot = { org, repoName };
    }
    state.entries[entry.repo] = record;
    await writeState(opts.statePath, state);

    try {
      for (const step of STEP_NAMES) {
        if (step === "submit-hb" && !opts.submitHb) {
          if (!completed.has(step)) {
            markStepStart(record, step, deps.now());
            markStepOk(record, step, {}, { skipped: true }, deps.now());
            await writeState(opts.statePath, state);
          }
          continue;
        }
        if (completed.has(step)) continue;

        markStepStart(record, step, deps.now());
        await writeState(opts.statePath, state);
        const result = await runOneStep(step, entry, record, opts, deps);
        if (result.outcome === "skipped") {
          record.status = "skipped";
          record.reason = result.reason;
          record.updatedAt = deps.now();
          await writeState(opts.statePath, state);
          break;
        }
        if (result.outcome === "failed") {
          record.status = "failed";
          record.reason = result.reason;
          record.updatedAt = deps.now();
          await writeState(opts.statePath, state);
          break;
        }
        markStepOk(record, step, result.data, result.data, deps.now());
        await writeState(opts.statePath, state);
      }
      if (record.status === "in-progress" && record.completedSteps.includes("confirm")) {
        record.status = "done";
        record.updatedAt = deps.now();
        await writeState(opts.statePath, state);
      }
    } catch (err) {
      record.updatedAt = deps.now();
      await writeState(opts.statePath, state);
      throw err;
    }
    results.push(record);
  }
  return results;
}

function splitFromEntry(
  repo: string,
  existing: EntryRecord | undefined,
): { org: string; repoName: string } {
  if (existing?.snapshot.org && existing.snapshot.repoName) {
    return { org: existing.snapshot.org, repoName: existing.snapshot.repoName };
  }
  const i = repo.indexOf("/");
  if (i <= 0) return { org: "unknown", repoName: repo };
  return { org: repo.slice(0, i), repoName: repo.slice(i + 1) };
}
