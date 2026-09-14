import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EXIT_CODES,
  EnspackError,
  addToLock,
  assertLockMatch,
  lockEntryFrom,
  lockKeyFor,
  namehashOf,
  readLock,
  removeFromLock,
  serializeLock,
  updateLock,
  writeLock,
} from "../../src/index.js";
import type { LockEntry, Lockfile, Manifest, Resolved } from "../../src/index.js";
import { loadTinyManifest } from "../install/helpers.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const CID_A = "bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CID_B = "bafkreibbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function entry(overrides: Partial<LockEntry> = {}): LockEntry {
  return {
    resolved: "v1-0-0.tiny-model.mirrors.enspack.eth",
    cid: CID_A,
    infohash: "d1cf46db7b8956eb9d609514b00a2a99c82b2daa",
    totalSize: 2097377,
    select: ["*"],
    ...overrides,
  };
}

function resolvedOf(manifest: Manifest, cid: string): Resolved & { manifest: Manifest } {
  return {
    name: manifest.name,
    node: namehashOf(manifest.name),
    cid,
    magnet: manifest.distribution.magnet,
    spec: manifest.spec,
    manifest,
    manifestBytes: null,
  };
}

describe("lockfile read/write", () => {
  it("round-trips byte-identically and sorts models keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "enspack-lock-"));
    dirs.push(dir);
    const path = join(dir, "enspack.lock");
    const lock: Lockfile = {
      lockfileVersion: 1,
      models: {
        "zzz.mirrors.enspack.eth": entry({ resolved: "v1-0-0.zzz.mirrors.enspack.eth" }),
        "aaa.mirrors.enspack.eth": entry({ resolved: "v1-0-0.aaa.mirrors.enspack.eth" }),
      },
    };
    await writeLock(lock, path);
    const first = await readFile(path, "utf8");
    expect(first.endsWith("\n")).toBe(true);
    expect(first.indexOf("aaa.mirrors.enspack.eth")).toBeLessThan(
      first.indexOf("zzz.mirrors.enspack.eth"),
    );
    expect(first).toBe(serializeLock(lock));
    await writeLock(await readLock(path), join(dir, "copy.lock"));
    expect(await readFile(join(dir, "copy.lock"))).toEqual(await readFile(path));
  });

  it("missing file → empty lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "enspack-lock-miss-"));
    dirs.push(dir);
    const lock = await readLock(join(dir, "enspack.lock"));
    expect(lock).toEqual({ lockfileVersion: 1, models: {} });
  });

  it("malformed JSON → LOCK", async () => {
    const dir = await mkdtemp(join(tmpdir(), "enspack-lock-bad-"));
    dirs.push(dir);
    const path = join(dir, "enspack.lock");
    await writeFile(path, "{not json", "utf8");
    await expect(readLock(path)).rejects.toMatchObject({ code: "LOCK" });
  });

  it("schema-invalid → LOCK", async () => {
    const dir = await mkdtemp(join(tmpdir(), "enspack-lock-inv-"));
    dirs.push(dir);
    const path = join(dir, "enspack.lock");
    await writeFile(
      path,
      `${JSON.stringify({
        lockfileVersion: 1,
        models: {
          "tiny-model.mirrors.enspack.eth": {
            resolved: "v1-0-0.tiny-model.mirrors.enspack.eth",
            cid: "not-a-cid",
            infohash: "0000000000000000000000000000000000000000",
            totalSize: 1,
          },
        },
      })}\n`,
      "utf8",
    );
    try {
      await readLock(path);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(EnspackError);
      expect(e).toMatchObject({ code: "LOCK" });
    }
  });
});

describe("lockEntryFrom / add / update / remove", () => {
  it("lockEntryFrom copies name, cid, infohash, totalSize, select, upstream", () => {
    const manifest = loadTinyManifest();
    const withUpstream: Manifest = {
      ...manifest,
      upstream: {
        provider: "huggingface",
        repo: "enspack/tiny-model",
        url: "https://huggingface.co/enspack/tiny-model",
        revision: "abc",
      },
    };
    const got = lockEntryFrom(resolvedOf(withUpstream, CID_A), ["config.json"]);
    expect(got).toEqual({
      resolved: withUpstream.name,
      cid: CID_A,
      infohash: manifest.distribution.infohash,
      totalSize: manifest.totalSize,
      select: ["config.json"],
      upstream: { repo: "enspack/tiny-model", revision: "abc" },
    });
    expect(lockEntryFrom(resolvedOf(manifest, CID_A)).select).toEqual(["*"]);
  });

  it("addToLock appends; updateLock rewrites; removeFromLock drops", () => {
    const empty: Lockfile = { lockfileVersion: 1, models: {} };
    const added = addToLock(empty, "tiny-model.mirrors.enspack.eth", entry());
    expect(added.models["tiny-model.mirrors.enspack.eth"]?.cid).toBe(CID_A);
    const updated = updateLock(added, "tiny-model.mirrors.enspack.eth", entry({ cid: CID_B }));
    expect(updated.models["tiny-model.mirrors.enspack.eth"]?.cid).toBe(CID_B);
    const removed = removeFromLock(updated, "tiny-model.mirrors.enspack.eth");
    expect(removed.models).toEqual({});
    expect(() => addToLock(added, "tiny-model.mirrors.enspack.eth", entry())).toThrow(EnspackError);
    expect(() => updateLock(empty, "tiny-model.mirrors.enspack.eth", entry())).toThrow(
      EnspackError,
    );
  });
});

describe("assertLockMatch", () => {
  it("CID mismatch throws code LOCK with EXIT_CODES[code] === 3; update: true passes", () => {
    const lock: Lockfile = {
      lockfileVersion: 1,
      models: { "tiny-model.mirrors.enspack.eth": entry() },
    };
    expect(() => assertLockMatch(lock, "tiny-model.mirrors.enspack.eth", CID_A)).not.toThrow();
    try {
      assertLockMatch(lock, "tiny-model.mirrors.enspack.eth", CID_B);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(EnspackError);
      expect(e).toMatchObject({ code: "LOCK" });
      const code = e instanceof EnspackError ? e.code : "VERIFY";
      expect(EXIT_CODES[code]).toBe(3);
      expect(String(e)).toMatch(
        /tiny-model\.mirrors\.enspack\.eth resolved to .* but enspack\.lock pins .*run enspack update to accept/,
      );
    }
    expect(() =>
      assertLockMatch(lock, "tiny-model.mirrors.enspack.eth", CID_B, { update: true }),
    ).not.toThrow();
  });

  it("lookup: exact key, else any entry whose resolved === name", () => {
    const lock: Lockfile = {
      lockfileVersion: 1,
      models: { "tiny-model.mirrors.enspack.eth": entry() },
    };
    expect(() =>
      assertLockMatch(lock, "v1-0-0.tiny-model.mirrors.enspack.eth", CID_A),
    ).not.toThrow();
    expect(() => assertLockMatch(lock, "v1-0-0.tiny-model.mirrors.enspack.eth", CID_B)).toThrow(
      EnspackError,
    );
  });
});

describe("lockKeyFor", () => {
  it('lockKeyFor("m.pub.enspack.eth@1.0.0") === "m.pub.enspack.eth"', () => {
    expect(lockKeyFor("m.pub.enspack.eth@1.0.0")).toBe("m.pub.enspack.eth");
  });

  it("bare version name keys by itself", () => {
    expect(lockKeyFor("v1-0-0.tiny-model.mirrors.enspack.eth")).toBe(
      "v1-0-0.tiny-model.mirrors.enspack.eth",
    );
    expect(lockKeyFor("tiny-model.mirrors.enspack.eth")).toBe("tiny-model.mirrors.enspack.eth");
  });
});
