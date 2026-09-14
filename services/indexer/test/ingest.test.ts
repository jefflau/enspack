import { canonicalJson, manifestCid, namehashOf } from "@enspack/core";
import { describe, expect, it } from "vitest";
import { ingestContenthashChanged, ingestTextChanged } from "../src/ingest.js";
import { createMemoryRepository } from "../src/memory-repo.js";
import { RESOLVER, TX_A, TX_B, TX_C, buildManifest, fakeStore, ipfsHash } from "./helpers.js";

const CHAIN = "sepolia";

describe("ingest ContenthashChanged", () => {
  it("on the version node upserts versions and learns nodes", async () => {
    const built = await buildManifest();
    const repo = createMemoryRepository();
    const store = fakeStore(new Map([[built.cid, built.bytes]]));

    await ingestContenthashChanged({
      store,
      repo,
      chain: CHAIN,
      node: built.versionNode,
      hash: ipfsHash(built.cid),
      block: 10,
      txHash: TX_A,
    });

    const version = await repo.findVersionByNode(built.versionNode, CHAIN);
    expect(version?.cid).toBe(built.cid);
    expect(version?.name).toBe(built.manifest.name);
    expect(version?.model).toBe(built.manifest.model);
    expect(version?.manifestJson).toBe(new TextDecoder().decode(built.bytes));

    expect((await repo.findNode(built.versionNode, CHAIN))?.name).toBe(built.manifest.name);
    expect((await repo.findNode(built.modelNode, CHAIN))?.name).toBe(built.manifest.model);
    expect((await repo.findNode(built.publisherNode, CHAIN))?.name).toBe(built.manifest.publisher);
    expect(await repo.listNames()).toEqual([]);
  });

  it("on the model node updates names latest and upserts publishers", async () => {
    const built = await buildManifest();
    const repo = createMemoryRepository();
    const store = fakeStore(new Map([[built.cid, built.bytes]]));

    await ingestContenthashChanged({
      store,
      repo,
      chain: CHAIN,
      node: built.modelNode,
      hash: ipfsHash(built.cid),
      block: 11,
      txHash: TX_A,
    });

    const name = await repo.findName(built.manifest.model, CHAIN);
    expect(name?.latestName).toBe(built.manifest.name);
    expect(name?.latestVersion).toBe(built.manifest.version);
    expect(name?.latestCid).toBe(built.cid);
    expect(name?.license).toBe(built.manifest.license);
    expect(name?.totalSize).toBe(built.manifest.totalSize);
    expect(name?.publisher).toBe(built.manifest.publisher);

    const publisher = await repo.findPublisher(built.manifest.publisher, CHAIN);
    expect(publisher?.spec).toBe("enspack/0.1");
    expect(publisher?.hf).toBe("");
  });

  it("name/node mismatch records an error and writes no rows", async () => {
    const built = await buildManifest();
    const repo = createMemoryRepository();
    const store = fakeStore(new Map([[built.cid, built.bytes]]));
    const other = namehashOf("other.mirrors.enspack.eth");

    await ingestContenthashChanged({
      store,
      repo,
      chain: CHAIN,
      node: other,
      hash: ipfsHash(built.cid),
      block: 12,
      txHash: TX_A,
    });

    expect(await repo.listNames()).toEqual([]);
    expect(await repo.listVersions()).toEqual([]);
    const errs = await repo.listErrors();
    expect(errs).toHaveLength(1);
    expect(errs[0]?.reason).toBe("name/node mismatch");
  });

  it("invalid manifest JSON records an errors row", async () => {
    const bytes = new TextEncoder().encode("{not-json");
    const cid = await manifestCid(bytes);
    const repo = createMemoryRepository();
    const store = fakeStore(new Map([[cid, bytes]]));
    const node = namehashOf("v1-0-0.tiny-model.mirrors.enspack.eth");

    await ingestContenthashChanged({
      store,
      repo,
      chain: CHAIN,
      node,
      hash: ipfsHash(cid),
      block: 13,
      txHash: TX_A,
    });

    expect(await repo.listVersions()).toEqual([]);
    expect((await repo.listErrors())[0]?.reason).toBe("invalid manifest JSON");
  });

  it("schema failure records an errors row", async () => {
    const bytes = canonicalJson({ spec: "nope" });
    const cid = await manifestCid(bytes);
    const repo = createMemoryRepository();
    const store = fakeStore(new Map([[cid, bytes]]));

    await ingestContenthashChanged({
      store,
      repo,
      chain: CHAIN,
      node: namehashOf("tiny-model.mirrors.enspack.eth"),
      hash: ipfsHash(cid),
      block: 14,
      txHash: TX_A,
    });

    expect(await repo.listNames()).toEqual([]);
    expect((await repo.listErrors())[0]?.reason).toMatch(/spec|required|invalid/i);
  });

  it("store hash mismatch (FETCH) records an errors row", async () => {
    const built = await buildManifest();
    const repo = createMemoryRepository();
    const store = fakeStore(new Map([[built.cid, built.bytes]]), built.cid);

    await ingestContenthashChanged({
      store,
      repo,
      chain: CHAIN,
      node: built.versionNode,
      hash: ipfsHash(built.cid),
      block: 15,
      txHash: TX_A,
    });

    expect(await repo.listVersions()).toEqual([]);
    expect((await repo.listErrors())[0]?.reason).toBe("hash mismatch");
  });

  it("non-ipfs contenthash records an errors row", async () => {
    const built = await buildManifest();
    const repo = createMemoryRepository();
    const store = fakeStore(new Map([[built.cid, built.bytes]]));

    await ingestContenthashChanged({
      store,
      repo,
      chain: CHAIN,
      node: built.versionNode,
      hash: "0x1234",
      block: 16,
      txHash: TX_A,
    });

    expect(await repo.listVersions()).toEqual([]);
    expect((await repo.listErrors())[0]?.reason).toBe("contenthash is not ipfs");
  });
});

describe("ingest violations (SPEC §6.2)", () => {
  it("second ContenthashChanged on a version node with a different CID flags a violation and keeps the row", async () => {
    const first = await buildManifest();
    const second = await buildManifest({ version: "1.0.1" });
    const repo = createMemoryRepository();
    const store = fakeStore(
      new Map([
        [first.cid, first.bytes],
        [second.cid, second.bytes],
      ]),
    );

    await ingestContenthashChanged({
      store,
      repo,
      chain: CHAIN,
      node: first.versionNode,
      hash: ipfsHash(first.cid),
      block: 20,
      txHash: TX_A,
    });
    await ingestContenthashChanged({
      store,
      repo,
      chain: CHAIN,
      node: first.versionNode,
      hash: ipfsHash(second.cid),
      block: 21,
      txHash: TX_B,
    });

    const version = await repo.findVersionByNode(first.versionNode, CHAIN);
    expect(version?.cid).toBe(first.cid);
    const flags = await repo.listViolations();
    expect(flags).toHaveLength(1);
    expect(flags[0]?.previousCid).toBe(first.cid);
    expect(flags[0]?.newCid).toBe(second.cid);
    expect(flags[0]?.block).toBe(21);
    expect(flags[0]?.name).toBe(first.manifest.name);
  });

  it("the same CID again does not create a violation", async () => {
    const built = await buildManifest();
    const repo = createMemoryRepository();
    const store = fakeStore(new Map([[built.cid, built.bytes]]));

    await ingestContenthashChanged({
      store,
      repo,
      chain: CHAIN,
      node: built.versionNode,
      hash: ipfsHash(built.cid),
      block: 22,
      txHash: TX_A,
    });
    await ingestContenthashChanged({
      store,
      repo,
      chain: CHAIN,
      node: built.versionNode,
      hash: ipfsHash(built.cid),
      block: 23,
      txHash: TX_C,
    });

    expect(await repo.listViolations()).toEqual([]);
    expect((await repo.findVersionByNode(built.versionNode, CHAIN))?.cid).toBe(built.cid);
  });
});

describe("ingest TextChanged", () => {
  it("com.enspack.spec triggers processing of the current contenthash", async () => {
    const built = await buildManifest();
    const repo = createMemoryRepository();
    const store = fakeStore(new Map([[built.cid, built.bytes]]));

    await ingestTextChanged({
      store,
      repo,
      chain: CHAIN,
      node: built.versionNode,
      key: "com.enspack.spec",
      value: "enspack/0.1",
      resolver: RESOLVER,
      block: 30,
      txHash: TX_A,
      readContenthash: async () => ipfsHash(built.cid),
    });

    expect((await repo.findVersionByNode(built.versionNode, CHAIN))?.cid).toBe(built.cid);
  });

  it("a different key is ignored", async () => {
    const built = await buildManifest();
    const repo = createMemoryRepository();
    const store = fakeStore(new Map([[built.cid, built.bytes]]));

    await ingestTextChanged({
      store,
      repo,
      chain: CHAIN,
      node: built.versionNode,
      key: "com.enspack.magnet",
      value: "magnet:?xt=urn:btih:d1cf46db7b8956eb9d609514b00a2a99c82b2daa",
      resolver: RESOLVER,
      block: 31,
      txHash: TX_A,
      readContenthash: async () => {
        throw new Error("readContract should not be called");
      },
    });

    expect(await repo.listVersions()).toEqual([]);
    expect(await repo.listErrors()).toEqual([]);
    expect(await repo.listNames()).toEqual([]);
  });

  it("com.enspack.hf sets publishers.hf", async () => {
    const built = await buildManifest();
    const repo = createMemoryRepository();
    const store = fakeStore(new Map([[built.cid, built.bytes]]));

    await ingestContenthashChanged({
      store,
      repo,
      chain: CHAIN,
      node: built.modelNode,
      hash: ipfsHash(built.cid),
      block: 32,
      txHash: TX_A,
    });

    await ingestTextChanged({
      store,
      repo,
      chain: CHAIN,
      node: built.publisherNode,
      key: "com.enspack.hf",
      value: "tiny-org",
      resolver: RESOLVER,
      block: 33,
      txHash: TX_B,
      readContenthash: async () => "0x",
    });

    expect((await repo.findPublisher(built.manifest.publisher, CHAIN))?.hf).toBe("tiny-org");
  });
});
