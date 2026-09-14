import { MANIFEST_MAX_BYTES, TORRENT_MAX_BYTES, manifestCid } from "@enspack/core";
import { describe, expect, it } from "vitest";
import { makeTestApp } from "./helpers/app.js";
import { loadTinyFixture } from "./helpers/fixtures.js";

describe("POST /v1/pin", () => {
  it("valid manifest → 201 raw CID", async () => {
    const fx = await loadTinyFixture();
    const { app } = await makeTestApp(fx);
    const res = await app.request("/v1/pin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: fx.manifestBytes,
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ cid: fx.cid });
  });

  it("valid torrent → 201 raw CID", async () => {
    const fx = await loadTinyFixture();
    const { app } = await makeTestApp(fx);
    const res = await app.request("/v1/pin", {
      method: "POST",
      headers: { "content-type": "application/x-bittorrent" },
      body: fx.torrentBytes,
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ cid: fx.torrentCid });
  });

  it("content-length above cap → 413", async () => {
    const fx = await loadTinyFixture();
    const { app } = await makeTestApp(fx);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    });
    const res = await app.request(
      new Request("http://seed.test/v1/pin", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(MANIFEST_MAX_BYTES + 1),
        },
        body: stream,
        duplex: "half",
      } as RequestInit),
    );
    expect(res.status).toBe(413);
  });

  it("chunked body above cap → 413", async () => {
    const fx = await loadTinyFixture();
    const { app } = await makeTestApp(fx);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MANIFEST_MAX_BYTES + 1));
        controller.close();
      },
    });
    const torrentOversize = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(TORRENT_MAX_BYTES + 1));
        controller.close();
      },
    });
    const jsonRes = await app.request(
      new Request("http://seed.test/v1/pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: stream,
        duplex: "half",
      } as RequestInit),
    );
    expect(jsonRes.status).toBe(413);
    const torrentRes = await app.request(
      new Request("http://seed.test/v1/pin", {
        method: "POST",
        headers: { "content-type": "application/x-bittorrent" },
        body: torrentOversize,
        duplex: "half",
      } as RequestInit),
    );
    expect(torrentRes.status).toBe(413);
  });

  it("invalid manifest JSON → 422", async () => {
    const fx = await loadTinyFixture();
    const { app } = await makeTestApp(fx);
    const res = await app.request("/v1/pin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ not: "a manifest" }),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "VERIFY" });
  });

  it("wrong content type → 415", async () => {
    const fx = await loadTinyFixture();
    const { app } = await makeTestApp(fx);
    const res = await app.request("/v1/pin", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "hello",
    });
    expect(res.status).toBe(415);
  });

  it("Kubo returning a different CID → 500 PUBLISH", async () => {
    const fx = await loadTinyFixture();
    const { app, kubo } = await makeTestApp(fx);
    kubo.overrideCid = "bafkreiwrongcidfromkubowrongcidfromkubowrongcidfromk";
    const res = await app.request("/v1/pin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: fx.manifestBytes,
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "PUBLISH" });
    expect(await manifestCid(fx.manifestBytes)).toBe(fx.cid);
  });
});
