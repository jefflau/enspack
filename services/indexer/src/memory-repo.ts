import type {
  ErrorRow,
  IndexerRepository,
  NameRow,
  NodeRow,
  PublisherRow,
  VersionRow,
  ViolationRow,
} from "./repo.js";

function key2(a: string, b: string): string {
  return `${a}\0${b}`;
}

function key4(a: string, b: string, c: string, d: string): string {
  return `${a}\0${b}\0${c}\0${d}`;
}

/**
 * In-memory repository for ingest/API unit tests (no Ponder, no network).
 */
export function createMemoryRepository(): IndexerRepository {
  const nameRows = new Map<string, NameRow>();
  const versionRows = new Map<string, VersionRow>();
  const publisherRows = new Map<string, PublisherRow>();
  const nodeRows = new Map<string, NodeRow>();
  const violationRows = new Map<string, ViolationRow>();
  const errorRows = new Map<string, ErrorRow>();

  return {
    async findVersionByNode(node, chain) {
      return versionRows.get(key2(node.toLowerCase(), chain)) ?? null;
    },
    async insertVersion(row) {
      versionRows.set(key2(row.node.toLowerCase(), row.chain), {
        ...row,
        node: row.node.toLowerCase(),
        txHash: row.txHash.toLowerCase(),
      });
    },
    async findName(model, chain) {
      return nameRows.get(key2(model, chain)) ?? null;
    },
    async upsertName(row) {
      nameRows.set(key2(row.model, row.chain), row);
    },
    async findPublisher(name, chain) {
      return publisherRows.get(key2(name, chain)) ?? null;
    },
    async upsertPublisher(row) {
      publisherRows.set(key2(row.name, row.chain), row);
    },
    async findNode(node, chain) {
      return nodeRows.get(key2(node.toLowerCase(), chain)) ?? null;
    },
    async upsertNode(row) {
      nodeRows.set(key2(row.node.toLowerCase(), row.chain), {
        ...row,
        node: row.node.toLowerCase(),
      });
    },
    async insertViolation(row) {
      const k = key4(
        row.node.toLowerCase(),
        row.chain,
        String(row.block),
        row.txHash.toLowerCase(),
      );
      if (!violationRows.has(k)) {
        violationRows.set(k, {
          ...row,
          node: row.node.toLowerCase(),
          txHash: row.txHash.toLowerCase(),
        });
      }
    },
    async insertError(row) {
      const k = key4(
        row.node.toLowerCase(),
        row.chain,
        String(row.block),
        row.txHash.toLowerCase(),
      );
      errorRows.set(k, {
        ...row,
        node: row.node.toLowerCase(),
        txHash: row.txHash.toLowerCase(),
      });
    },
    async listNames() {
      return [...nameRows.values()].sort((a, b) =>
        a.model === b.model ? a.chain.localeCompare(b.chain) : a.model.localeCompare(b.model),
      );
    },
    async listVersions() {
      return [...versionRows.values()];
    },
    async listPublishers() {
      return [...publisherRows.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    async listViolations() {
      return [...violationRows.values()].sort((a, b) => a.block - b.block);
    },
    async listErrors() {
      return [...errorRows.values()];
    },
  };
}
