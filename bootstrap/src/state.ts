import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BootstrapState, EntryRecord, EntrySnapshot, StepName } from "./types.js";

function emptyState(): BootstrapState {
  return { version: 1, entries: {} };
}

/**
 * BOOTSTRAP.md §5: atomic write of `bootstrap/state.json` (temp file, fsync, rename).
 */
export async function writeState(path: string, state: BootstrapState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const json = `${JSON.stringify(state, null, 2)}\n`;
  await writeFile(tmp, json);
  const fh = await open(tmp, "r+");
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, path);
}

/** BOOTSTRAP.md §5: load runner state; missing file is an empty map. */
export async function readState(path: string): Promise<BootstrapState> {
  try {
    const text = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return emptyState();
    }
    const rec = parsed as Partial<BootstrapState>;
    if (rec.version !== 1 || rec.entries === undefined || typeof rec.entries !== "object") {
      return emptyState();
    }
    return { version: 1, entries: rec.entries };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyState();
    throw err;
  }
}

export function newEntryRecord(repo: string, snapshot: EntrySnapshot, now: string): EntryRecord {
  return {
    repo,
    status: "pending",
    completedSteps: [],
    snapshot,
    outputs: {},
    timestamps: {},
    updatedAt: now,
  };
}

export function markStepStart(record: EntryRecord, step: StepName, now: string): void {
  record.step = step;
  record.status = "in-progress";
  record.timestamps[step] = { startedAt: now };
  record.updatedAt = now;
}

export function markStepOk(
  record: EntryRecord,
  step: StepName,
  data: Partial<EntrySnapshot>,
  output: unknown,
  now: string,
): void {
  const ts = record.timestamps[step];
  if (ts !== undefined) ts.finishedAt = now;
  if (!record.completedSteps.includes(step)) record.completedSteps.push(step);
  record.outputs[step] = output ?? data;
  record.snapshot = { ...record.snapshot, ...data };
  record.updatedAt = now;
}
