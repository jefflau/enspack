import { describe, expect, it } from "vitest";
import { makeTestApp } from "./helpers/app.js";
import { loadTinyFixture } from "./helpers/fixtures.js";

describe("GET /v1/health", () => {
  it("both deps up → 200 { ok: true, qbittorrent: true, kubo: true, chain }", async () => {
    const fx = await loadTinyFixture();
    const { app } = await makeTestApp(fx);
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      qbittorrent: true,
      kubo: true,
      chain: "sepolia",
    });
  });

  it("qBittorrent down → 200 with qbittorrent: false", async () => {
    const fx = await loadTinyFixture();
    const { app, qbt } = await makeTestApp(fx);
    qbt.failLogin = true;
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      qbittorrent: false,
      kubo: true,
      chain: "sepolia",
    });
  });
});
