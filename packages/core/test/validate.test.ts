import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EnspackError, validateLock, validateManifest } from "../src/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function loadExample(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      join(repoRoot, "examples/qwen--qwen2-5-7b-instruct.enspack.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

describe("validateManifest extra SPEC §3 rules", () => {
  it("rejects magnet/infohash mismatch", () => {
    const m = loadExample();
    const distribution = { ...(m.distribution as Record<string, unknown>) };
    distribution.infohash = "1111111111111111111111111111111111111111";
    m.distribution = distribution;
    expect(() => validateManifest(m)).toThrow(EnspackError);
    try {
      validateManifest(m);
    } catch (e) {
      expect(e).toMatchObject({ code: "VERIFY" });
      expect(String(e)).toMatch(/infohash/i);
    }
  });

  it("rejects duplicate files[].path", () => {
    const m = loadExample();
    const files = m.files as unknown[];
    const first = files[0];
    m.files = [first, first];
    expect(() => validateManifest(m)).toThrow(EnspackError);
    try {
      validateManifest(m);
    } catch (e) {
      expect(e).toMatchObject({ code: "VERIFY" });
      expect(String(e)).toMatch(/duplicate/i);
    }
  });

  it("rejects totalSize mismatch", () => {
    const m = loadExample();
    m.totalSize = 1;
    expect(() => validateManifest(m)).toThrow(EnspackError);
    try {
      validateManifest(m);
    } catch (e) {
      expect(e).toMatchObject({ code: "VERIFY" });
      expect(String(e)).toMatch(/totalSize/);
    }
  });

  it("rejects a bad versions[] tail", () => {
    const m = loadExample();
    const versions = structuredClone(m.versions) as { version: string; name: string }[];
    const last = versions[versions.length - 1];
    if (last === undefined) {
      throw new Error("fixture versions[] empty");
    }
    last.version = "9.9.9";
    m.versions = versions;
    expect(() => validateManifest(m)).toThrow(EnspackError);
    try {
      validateManifest(m);
    } catch (e) {
      expect(e).toMatchObject({ code: "VERIFY" });
      expect(String(e)).toMatch(/versions/);
    }
  });

  it("returns readable ajv errors", () => {
    expect(() => validateManifest({ spec: "nope" })).toThrow(EnspackError);
    try {
      validateManifest({ spec: "nope" });
    } catch (e) {
      expect(e).toBeInstanceOf(EnspackError);
      expect(e).toMatchObject({ code: "VERIFY" });
      const message = e instanceof EnspackError ? e.message : "";
      expect(message.length).toBeGreaterThan(10);
      expect(message).toMatch(/must/i);
    }
  });
});

describe("validateLock", () => {
  it("rejects a bad CID", () => {
    const lock = {
      lockfileVersion: 1,
      models: {
        "qwen--qwen2-5-7b-instruct.mirrors.enspack.eth": {
          resolved: "v1-0-0.qwen--qwen2-5-7b-instruct.mirrors.enspack.eth",
          cid: "not-a-cid",
          infohash: "0000000000000000000000000000000000000000",
          totalSize: 1,
        },
      },
    };
    expect(() => validateLock(lock)).toThrow(EnspackError);
    try {
      validateLock(lock);
    } catch (e) {
      expect(e).toMatchObject({ code: "VERIFY" });
      const message = e instanceof EnspackError ? e.message : "";
      expect(message).toMatch(/cid/i);
    }
  });

  it("accepts a schema-valid lockfile", () => {
    const lock = validateLock({
      lockfileVersion: 1,
      models: {
        "qwen--qwen2-5-7b-instruct.mirrors.enspack.eth": {
          resolved: "v1-0-0.qwen--qwen2-5-7b-instruct.mirrors.enspack.eth",
          cid: "bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          infohash: "0000000000000000000000000000000000000000",
          totalSize: 15242807270,
        },
      },
    });
    expect(lock.lockfileVersion).toBe(1);
  });
});
