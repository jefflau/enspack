import { describe, expect, it } from "vitest";
import { seedEnsOpts } from "../src/env.js";
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
      ensVersion: "v2",
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
      ensVersion: "v2",
    });
  });

  it("reports ensVersion from deps when set", async () => {
    const fx = await loadTinyFixture();
    const { app } = await makeTestApp(fx, { ensVersion: "v1", chain: "mainnet" });
    const res = await app.request("/v1/health");
    expect(await res.json()).toMatchObject({ ensVersion: "v1", chain: "mainnet" });
  });
});

describe("seedEnsOpts", () => {
  it("defaults sepolia to v2 and honors ENSPACK_ENS_VERSION", () => {
    expect(seedEnsOpts("sepolia", {}).ensVersion).toBe("v2");
    expect(seedEnsOpts("sepolia", {}).ensV2?.universalResolver).toBe(
      "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe",
    );
    expect(seedEnsOpts("sepolia", { ENSPACK_ENS_VERSION: "v1" }).ensVersion).toBe("v1");
    expect(seedEnsOpts("mainnet", {}).ensVersion).toBe("v1");
  });
});
