import type { Manifest, ManifestFile } from "@enspack/core";

/** BOOTSTRAP.md §5: ordered, resumable steps recorded in `bootstrap/state.json`. */
export const STEP_NAMES = [
  "gate",
  "files",
  "download",
  "verify",
  "torrent",
  "pin",
  "publish",
  "seed",
  "submit-hb",
  "confirm",
] as const;

export type StepName = (typeof STEP_NAMES)[number];

export type EntryStatus = "pending" | "in-progress" | "done" | "failed" | "skipped";

export type HbCrossCheckStatus = "ok" | "no-artifact" | "failed" | "skipped";

export interface ModelEntry {
  repo: string;
  tier: number;
  expected_license: string;
  revision: string;
  storage_gb?: number;
  note?: string;
  example?: string;
}

export interface ModelsConfig {
  publisher: string;
  licenseAllowlist: readonly string[];
  webseeds: {
    huggingface: string;
    huggingbay: string;
  };
  models: ModelEntry[];
}

export interface StepTimestamp {
  startedAt: string;
  finishedAt?: string;
}

export interface EntrySnapshot {
  org: string;
  repoName: string;
  revision?: string;
  license?: string;
  snapshotSize?: number;
  fileCount?: number;
  files?: ManifestFile[];
  hbCrossCheck?: HbCrossCheckStatus;
  hbId?: string;
  hbDigest?: string;
  downloadDir?: string;
  infohash?: string;
  magnet?: string;
  webseeds?: string[];
  torrentB64?: string;
  torrentCid?: string;
  manifest?: Manifest;
  manifestCid?: string;
  version?: string;
  versionName?: string;
  modelName?: string;
  previous?: string;
  txs?: string[];
  quarantined?: string;
}

export interface EntryRecord {
  repo: string;
  status: EntryStatus;
  step?: StepName;
  completedSteps: StepName[];
  reason?: string;
  snapshot: EntrySnapshot;
  outputs: Record<string, unknown>;
  timestamps: Partial<Record<StepName, StepTimestamp>>;
  updatedAt: string;
}

export interface BootstrapState {
  version: 1;
  entries: Record<string, EntryRecord>;
}

export type StepOutcome =
  | { outcome: "ok"; data: Partial<EntrySnapshot> }
  | { outcome: "skipped"; reason: string }
  | { outcome: "failed"; reason: string };
