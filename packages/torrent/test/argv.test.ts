import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnspackError } from "@enspack/core";
import type { Manifest } from "@enspack/core";
import { describe, expect, it } from "vitest";
import { Aria2Downloader, checkMagnet } from "../src/index.js";
import { manifestPath, torrentPath } from "./helpers/paths.js";
import { fakeSpawn } from "./helpers/spawn-fake.js";

const HEX = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
}

describe("argv injection", () => {
  it("checkMagnet('--dir=/etc') throws VERIFY before any spawn", async () => {
    const { spawnImpl, calls } = fakeSpawn();
    expect(() => checkMagnet("--dir=/etc")).toThrow(EnspackError);
    const dir = await mkdtemp(join(tmpdir(), "enspack-argv-"));
    try {
      const dl = new Aria2Downloader({ spawnImpl });
      const m = loadManifest();
      m.distribution.magnet = "--dir=/etc";
      await expect(dl.fetch(m, dir, {})).rejects.toMatchObject({ code: "VERIFY" });
      expect(calls).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("checkMagnet with non-hex infohash throws VERIFY before any spawn", async () => {
    const { spawnImpl, calls } = fakeSpawn();
    const bad = `magnet:?xt=urn:btih:${"z".repeat(40)}`;
    expect(() => checkMagnet(bad)).toThrow(EnspackError);
    const dir = await mkdtemp(join(tmpdir(), "enspack-argv-"));
    try {
      const dl = new Aria2Downloader({ spawnImpl });
      const m = loadManifest();
      m.distribution.magnet = bad;
      await expect(dl.fetch(m, dir, {})).rejects.toMatchObject({ code: "VERIFY" });
      expect(calls).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("valid magnet with extra text after & is a single argv element after --", async () => {
    const magnet = `magnet:?xt=urn:btih:${HEX}&dn=x --dir=/etc`;
    expect(checkMagnet(magnet)).toBe(magnet);
    const { spawnImpl, calls } = fakeSpawn();
    const dir = await mkdtemp(join(tmpdir(), "enspack-argv-"));
    try {
      const dl = new Aria2Downloader({ spawnImpl });
      const m = loadManifest();
      m.distribution.magnet = magnet;
      await dl.fetch(m, dir, {}).catch(() => {
        /* fake spawn does not write metainfo; argv is the assertion */
      });
      expect(calls.length).toBeGreaterThan(0);
      const first = calls[0];
      if (first === undefined) throw new Error("spawn not called");
      expect(first.options.shell).toBeUndefined();
      const dash = first.args.lastIndexOf("--");
      expect(dash).toBeGreaterThanOrEqual(0);
      expect(first.args[dash + 1]).toBe(magnet);
      expect(first.args.filter((a) => a === magnet)).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("select *.json maps to --select-file indexes in metainfo order", async () => {
    const { spawnImpl, calls } = fakeSpawn();
    const dir = await mkdtemp(join(tmpdir(), "enspack-sel-"));
    try {
      const dl = new Aria2Downloader({ spawnImpl });
      const m = loadManifest();
      const metainfo = new Uint8Array(readFileSync(torrentPath));
      await dl.fetch(m, dir, { metainfo, select: ["*.json"] });
      expect(calls.length).toBeGreaterThan(0);
      const first = calls[0];
      if (first === undefined) throw new Error("spawn not called");
      expect(first.options.shell).toBeUndefined();
      const select = first.args.find((a) => a.startsWith("--select-file="));
      expect(select).toBe("--select-file=1,3");
      const dash = first.args.indexOf("--");
      expect(dash).toBeGreaterThanOrEqual(0);
      expect(first.args[dash + 1]?.endsWith(".torrent")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
