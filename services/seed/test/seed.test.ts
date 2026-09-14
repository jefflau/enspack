import { readFile } from "node:fs/promises";
import { EnspackError } from "@enspack/core";
import { describe, expect, it } from "vitest";
import { stateFilePath } from "../src/state.js";
import { fixtureResolver, makeTestApp, throwingResolver } from "./helpers/app.js";
import { loadTinyFixture } from "./helpers/fixtures.js";

describe("POST /v1/seed", () => {
  it("happy path → 202 with fixture infohash; qBittorrent login then add; Kubo two block/put; state file; second call idempotent", async () => {
    const fx = await loadTinyFixture();
    const { app, qbt, kubo, downloadDir } = await makeTestApp(fx);

    const res = await app.request("/v1/seed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: fx.manifest.name }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { infohash: string; state: string };
    expect(body.infohash).toBe(fx.infohash);
    expect(typeof body.state).toBe("string");
    expect(body.state.length).toBeGreaterThan(0);

    const paths = qbt.requests.map((r) => r.url);
    const loginIdx = paths.findIndex((u) => u.includes("/auth/login"));
    const addIdx = paths.findIndex((u) => u.includes("/torrents/add"));
    expect(loginIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThan(loginIdx);
    expect(qbt.addedTorrents.length).toBe(1);
    const added = qbt.addedTorrents[0];
    expect(added).toBeDefined();
    if (added === undefined) throw new Error("missing add");
    expect(
      added.includes(Buffer.from(fx.torrentBytes)) || added.equals(Buffer.from(fx.torrentBytes)),
    ).toBe(true);
    expect(qbt.addedCategories).toEqual(["enspack"]);
    expect(qbt.addedTags).toEqual([fx.manifest.publisher]);

    const puts = kubo.requests.filter((r) => r.url.includes("/block/put"));
    expect(puts).toHaveLength(2);
    expect(kubo.putCids).toEqual([fx.cid, fx.torrentCid]);

    const stateRaw = await readFile(stateFilePath(downloadDir), "utf8");
    const state = JSON.parse(stateRaw) as {
      entries: { name: string; infohash: string; publisher: string }[];
    };
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toMatchObject({
      name: fx.manifest.name,
      infohash: fx.infohash,
      publisher: fx.manifest.publisher,
    });

    const again = await app.request("/v1/seed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: fx.manifest.name }),
    });
    expect(again.status).toBe(202);
    const againBody = (await again.json()) as { infohash: string; state: string };
    expect(againBody.infohash).toBe(fx.infohash);
    expect(qbt.addedTorrents).toHaveLength(1);
  });

  it("name outside allowRoots → 403 POLICY", async () => {
    const fx = await loadTinyFixture({
      name: "v1-0-0.x.other.eth",
      model: "x.other.eth",
      publisher: "other.eth",
    });
    const { app } = await makeTestApp(fx);
    const res = await app.request("/v1/seed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x.other.eth" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "POLICY" });
  });

  it("license not in allowlist → 403 POLICY", async () => {
    const fx = await loadTinyFixture({ license: "gpl-3.0" });
    const { app } = await makeTestApp(fx);
    const res = await app.request("/v1/seed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: fx.manifest.name }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "POLICY" });
  });

  it("quota exceeded → 403 POLICY naming the publisher", async () => {
    const fx = await loadTinyFixture();
    const { app } = await makeTestApp(fx, { quotaBytesPerPublisher: 1 });
    const res = await app.request("/v1/seed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: fx.manifest.name }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("POLICY");
    expect(body.error).toContain(fx.manifest.publisher);
  });

  it("resolver VERIFY (manifest validation / name-node mismatch) → 422", async () => {
    const fx = await loadTinyFixture();
    const { app } = await makeTestApp(fx, {
      resolver: throwingResolver(
        new EnspackError("VERIFY", "manifest name does not match resolved name"),
      ),
    });
    const res = await app.request("/v1/seed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: fx.manifest.name }),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "VERIFY" });
  });

  it("torrent infohash ≠ distribution.infohash → 422 VERIFY", async () => {
    const fx = await loadTinyFixture();
    const mismatch = {
      ...fx,
      resolved: {
        ...fx.resolved,
        manifest: {
          ...fx.manifest,
          distribution: {
            ...fx.manifest.distribution,
            infohash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        },
      },
    };
    const { app } = await makeTestApp(fx, { resolver: fixtureResolver(mismatch) });
    const res = await app.request("/v1/seed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: fx.manifest.name }),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "VERIFY" });
  });

  it("RESOLVE → 404", async () => {
    const fx = await loadTinyFixture();
    const { app } = await makeTestApp(fx, {
      resolver: throwingResolver(new EnspackError("RESOLVE", "name has no enspack records")),
    });
    const res = await app.request("/v1/seed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: fx.manifest.name }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "RESOLVE" });
  });

  it("bad body → 400", async () => {
    const fx = await loadTinyFixture();
    const { app } = await makeTestApp(fx);
    const missing = await app.request("/v1/seed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);
    const notJson = await app.request("/v1/seed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    expect(notJson.status).toBe(400);
  });
});
