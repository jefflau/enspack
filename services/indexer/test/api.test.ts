import { describe, expect, it } from "vitest";
import { createIndexerApi } from "../src/api/app.js";
import { ingestContenthashChanged } from "../src/ingest.js";
import { createMemoryRepository } from "../src/memory-repo.js";
import { TX_A, TX_B, TX_C, buildManifest, fakeStore, ipfsHash } from "./helpers.js";

const CHAIN = "sepolia";

async function seededRepo() {
  const a = await buildManifest({
    modelLabel: "alpha-model",
    displayName: "Alpha Display",
    upstream: {
      provider: "huggingface",
      repo: "Org/Alpha",
      url: "https://huggingface.co/Org/Alpha",
      revision: "aaa111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  });
  const b = await buildManifest({
    modelLabel: "beta-model",
    displayName: "Beta Display",
    upstream: {
      provider: "huggingface",
      repo: "Org/Beta",
      url: "https://huggingface.co/Org/Beta",
      revision: "bbb222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
  });
  const otherPub = await buildManifest({
    publisher: "other.enspack.eth",
    modelLabel: "gamma-model",
  });

  const repo = createMemoryRepository();
  const store = fakeStore(
    new Map([
      [a.cid, a.bytes],
      [b.cid, b.bytes],
      [otherPub.cid, otherPub.bytes],
    ]),
  );

  for (const built of [a, b, otherPub]) {
    await ingestContenthashChanged({
      store,
      repo,
      chain: CHAIN,
      node: built.versionNode,
      hash: ipfsHash(built.cid),
      block: 40,
      txHash: TX_A,
    });
    await ingestContenthashChanged({
      store,
      repo,
      chain: CHAIN,
      node: built.modelNode,
      hash: ipfsHash(built.cid),
      block: 41,
      txHash: TX_B,
    });
  }

  const aRepoint = await buildManifest({ modelLabel: "alpha-model", version: "1.0.1" });
  await ingestContenthashChanged({
    store: fakeStore(
      new Map([
        [a.cid, a.bytes],
        [aRepoint.cid, aRepoint.bytes],
      ]),
    ),
    repo,
    chain: CHAIN,
    node: a.versionNode,
    hash: ipfsHash(aRepoint.cid),
    block: 42,
    txHash: TX_C,
  });

  return { repo, a, b, otherPub, aRepoint, app: createIndexerApi(repo) };
}

describe("API §4.3", () => {
  it("paginates /v1/names with limit=1 then cursor", async () => {
    const { app } = await seededRepo();
    const first = await app.request("/v1/names?limit=1");
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      items: Array<{ model: string }>;
      nextCursor: string | null;
    };
    expect(firstBody.items).toHaveLength(1);
    expect(firstBody.nextCursor).toEqual(expect.any(String));

    const second = await app.request(`/v1/names?limit=1&cursor=${firstBody.nextCursor}`);
    const secondBody = (await second.json()) as {
      items: Array<{ model: string }>;
      nextCursor: string | null;
    };
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.items[0]?.model).not.toBe(firstBody.items[0]?.model);
  });

  it("filters /v1/names by publisher=", async () => {
    const { app, otherPub } = await seededRepo();
    const res = await app.request(`/v1/names?publisher=${otherPub.manifest.publisher}`);
    const body = (await res.json()) as { items: Array<{ model: string; publisher: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.publisher).toBe(otherPub.manifest.publisher);
    expect(body.items[0]?.model).toBe(otherPub.manifest.model);
  });

  it("filters /v1/names by q= substring on model/displayName/upstreamRepo", async () => {
    const { app, a } = await seededRepo();
    const byDisplay = await app.request("/v1/names?q=Alpha%20Display");
    const displayBody = (await byDisplay.json()) as { items: Array<{ model: string }> };
    expect(displayBody.items.map((i) => i.model)).toEqual([a.manifest.model]);

    const byRepo = await app.request("/v1/names?q=Org/Beta");
    const repoBody = (await byRepo.json()) as { items: Array<{ model: string }> };
    expect(repoBody.items).toHaveLength(1);
    expect(repoBody.items[0]?.model).toContain("beta-model");
  });

  it("GET /v1/names/:name returns versions and manifest", async () => {
    const { app, a } = await seededRepo();
    const res = await app.request(`/v1/names/${a.manifest.model}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      model: string;
      versions: Array<{ name: string; cid: string }>;
      manifest: { name: string; spec: string };
    };
    expect(body.model).toBe(a.manifest.model);
    expect(body.versions.length).toBeGreaterThanOrEqual(1);
    expect(body.manifest.name).toBe(a.manifest.name);
    expect(body.manifest.spec).toBe("enspack/0.1");
  });

  it("GET /v1/names/:name 404 shape", async () => {
    const { app } = await seededRepo();
    const res = await app.request("/v1/names/missing.enspack.eth");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown name", code: "NOT_FOUND" });
  });

  it("GET /v1/publishers returns name, hf, models count", async () => {
    const { app } = await seededRepo();
    const res = await app.request("/v1/publishers");
    const body = (await res.json()) as {
      items: Array<{ name: string; hf: string | null; models: number }>;
    };
    const mirrors = body.items.find((p) => p.name === "mirrors.enspack.eth");
    expect(mirrors?.models).toBe(2);
    expect(mirrors?.hf).toBeNull();
  });

  it("GET /v1/violations lists previousCid/newCid/block", async () => {
    const { app, a, aRepoint } = await seededRepo();
    const res = await app.request("/v1/violations");
    const body = (await res.json()) as {
      items: Array<{ name: string; previousCid: string; newCid: string; block: number }>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.name).toBe(a.manifest.name);
    expect(body.items[0]?.previousCid).toBe(a.cid);
    expect(body.items[0]?.newCid).toBe(aRepoint.cid);
    expect(body.items[0]?.block).toBe(42);
  });

  it("GET /v1/health", async () => {
    const { app } = await seededRepo();
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
