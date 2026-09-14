import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** MVP.md WP-09: one seeded name recorded under `SEED_DOWNLOAD_DIR/.enspack-seed-state.json`. */
export interface SeedRecord {
  name: string;
  publisher: string;
  infohash: string;
  totalSize: number;
  state: string;
  addedAt: string;
}

export interface SeedStateFile {
  entries: SeedRecord[];
}

export function stateFilePath(downloadDir: string): string {
  return join(downloadDir, ".enspack-seed-state.json");
}

async function readState(path: string): Promise<SeedStateFile> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { entries: [] };
    }
    const entries = (parsed as { entries?: unknown }).entries;
    if (!Array.isArray(entries)) {
      return { entries: [] };
    }
    const out: SeedRecord[] = [];
    for (const item of entries) {
      if (typeof item !== "object" || item === null) continue;
      const rec = item as Record<string, unknown>;
      if (
        typeof rec.name === "string" &&
        typeof rec.publisher === "string" &&
        typeof rec.infohash === "string" &&
        typeof rec.totalSize === "number" &&
        typeof rec.state === "string" &&
        typeof rec.addedAt === "string"
      ) {
        out.push({
          name: rec.name,
          publisher: rec.publisher,
          infohash: rec.infohash,
          totalSize: rec.totalSize,
          state: rec.state,
          addedAt: rec.addedAt,
        });
      }
    }
    return { entries: out };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { entries: [] };
    }
    throw err;
  }
}

/**
 * MVP.md WP-09: atomic replace of the seed state file (write temp, then rename).
 */
export async function writeStateAtomic(path: string, state: SeedStateFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export async function loadState(downloadDir: string): Promise<SeedStateFile> {
  return readState(stateFilePath(downloadDir));
}

export async function findByName(
  downloadDir: string,
  name: string,
): Promise<SeedRecord | undefined> {
  const state = await loadState(downloadDir);
  return state.entries.find((e) => e.name === name);
}

export function quotaUsedByPublisher(state: SeedStateFile, publisher: string): number {
  let sum = 0;
  for (const entry of state.entries) {
    if (entry.publisher === publisher) {
      sum += entry.totalSize;
    }
  }
  return sum;
}

export async function upsertRecord(downloadDir: string, record: SeedRecord): Promise<void> {
  const path = stateFilePath(downloadDir);
  const state = await readState(path);
  const idx = state.entries.findIndex((e) => e.name === record.name);
  if (idx === -1) {
    state.entries.push(record);
  } else {
    state.entries[idx] = record;
  }
  await writeStateAtomic(path, state);
}
