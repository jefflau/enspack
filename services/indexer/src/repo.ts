/** Rows stored by the indexer. Kept independent of Ponder so ingest/API tests need no runtime. */

export type NameRow = {
  model: string;
  publisher: string;
  chain: string;
  latestName: string;
  latestVersion: string;
  latestCid: string;
  upstreamRepo: string;
  upstreamRevision: string;
  license: string;
  totalSize: number;
  displayName: string;
  updatedBlock: number;
};

export type VersionRow = {
  name: string;
  model: string;
  chain: string;
  node: string;
  version: string;
  cid: string;
  createdAt: string;
  block: number;
  txHash: string;
  manifestJson: string;
};

export type PublisherRow = {
  name: string;
  chain: string;
  hf: string;
  spec: string;
};

export type ViolationRow = {
  name: string;
  node: string;
  chain: string;
  previousCid: string;
  newCid: string;
  block: number;
  txHash: string;
};

export type NodeRow = {
  node: string;
  chain: string;
  name: string;
  hf: string;
};

export type ErrorRow = {
  node: string;
  chain: string;
  reason: string;
  block: number;
  txHash: string;
};

/** Write path used by ingest (SPEC §2.3 / §6.2). */
export interface IndexerWriter {
  findVersionByNode(node: string, chain: string): Promise<VersionRow | null>;
  insertVersion(row: VersionRow): Promise<void>;
  findName(model: string, chain: string): Promise<NameRow | null>;
  upsertName(row: NameRow): Promise<void>;
  findPublisher(name: string, chain: string): Promise<PublisherRow | null>;
  upsertPublisher(row: PublisherRow): Promise<void>;
  findNode(node: string, chain: string): Promise<NodeRow | null>;
  upsertNode(row: NodeRow): Promise<void>;
  insertViolation(row: ViolationRow): Promise<void>;
  insertError(row: ErrorRow): Promise<void>;
}

/** Read path used by the §4.3 JSON API. */
export interface IndexerReader {
  listNames(): Promise<NameRow[]>;
  listVersions(): Promise<VersionRow[]>;
  listPublishers(): Promise<PublisherRow[]>;
  listViolations(): Promise<ViolationRow[]>;
  listErrors(): Promise<ErrorRow[]>;
}

export type IndexerRepository = IndexerWriter & IndexerReader;
