import { describe, expect, it } from "vitest";
import { makeTestApp } from "./helpers/app.js";
import { loadTinyFixture } from "./helpers/fixtures.js";

describe("GET /v1/status/:infohash", () => {
  it("maps state, progress, num_seeds/num_leechs → peers, uploaded", async () => {
    const fx = await loadTinyFixture();
    const { app, qbt } = await makeTestApp(fx);
    qbt.setTorrent({
      hash: fx.infohash,
      state: "uploading",
      progress: 0.42,
      num_seeds: 3,
      num_leechs: 5,
      uploaded: 12345,
    });
    const res = await app.request(`/v1/status/${fx.infohash}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      state: "uploading",
      progress: 0.42,
      peers: 8,
      uploaded: 12345,
    });
  });

  it("unknown infohash → 404", async () => {
    const fx = await loadTinyFixture();
    const { app } = await makeTestApp(fx);
    const res = await app.request("/v1/status/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(res.status).toBe(404);
  });

  it("malformed infohash → 400", async () => {
    const fx = await loadTinyFixture();
    const { app } = await makeTestApp(fx);
    const short = await app.request("/v1/status/abc");
    expect(short.status).toBe(400);
    const bad = await app.request("/v1/status/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz");
    expect(bad.status).toBe(400);
  });
});
