import type { Manifest, ManifestFile } from "@enspack/core";

export type { Manifest, ManifestFile };

/** Mirrors `services/indexer/src/api/app.ts` (MVP.md §4.3). Do not widen without changing the indexer. */
export interface NameListItem {
  model: string;
  publisher: string;
  latest: { name: string; version: string; cid: string };
  upstream: string;
  license: string;
  totalSize: number;
}

export interface NamesPage {
  items: NameListItem[];
  nextCursor: string | null;
}

export interface NameVersion {
  name: string;
  version: string;
  cid: string;
  createdAt: string;
}

export interface NameDetail {
  model: string;
  versions: NameVersion[];
  manifest: Manifest;
}

export interface PublisherItem {
  name: string;
  hf: string | null;
  models: number;
}

export interface PublishersPage {
  items: PublisherItem[];
}

export interface Violation {
  name: string;
  node: string;
  previousCid: string;
  newCid: string;
  block: number;
}

export interface ViolationsPage {
  items: Violation[];
}

/** Registrar `GET /v1/publishers/:label`. Shape is the registrar's; render as key/value. */
export type Attestation = Record<string, unknown>;

export interface ListNamesParams {
  q?: string;
  publisher?: string;
  cursor?: string;
  limit?: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}
