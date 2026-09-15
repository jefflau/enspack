import { readFileSync } from "node:fs";
import { EnspackError } from "@enspack/core";
import { describe, expect, it } from "vitest";
import { HuggingBayClient, crossCheck } from "../src/index.js";
import { createReplayFetch, exampleManifestPath } from "./replay-fetch.js";

describe("crossCheck", () => {
  it("passes against the matching Hugging Bay lock fixture", async () => {
    const example = JSON.parse(readFileSync(exampleManifestPath, "utf8")) as {
      files: { path: string; size: number; sha256: string; role: string }[];
    };
    const hb = new HuggingBayClient({ fetch: createReplayFetch() });
    const lock = await hb.lock("hf-model-qwen-qwen2-5-7b-instruct");
    if (lock === null) throw new Error("expected lock");
    expect(crossCheck(example.files, lock)).toEqual({ ok: true, compared: example.files.length });
  });

  it("throws VERIFY naming the path on a tampered sha256", async () => {
    const example = JSON.parse(readFileSync(exampleManifestPath, "utf8")) as {
      files: { path: string; size: number; sha256: string }[];
    };
    const hb = new HuggingBayClient({ fetch: createReplayFetch() });
    const lock = await hb.lock("hf-model-qwen-qwen2-5-7b-instruct");
    if (lock === null) throw new Error("expected lock");
    const tampered = {
      ...lock,
      files: lock.files.map((f) =>
        f.path === "config.json" ? { ...f, sha256: "0".repeat(64) } : f,
      ),
    };
    expect(() => crossCheck(example.files, tampered)).toThrow(EnspackError);
    try {
      crossCheck(example.files, tampered);
    } catch (err) {
      expect(err).toBeInstanceOf(EnspackError);
      expect((err as EnspackError).code).toBe("VERIFY");
      expect((err as Error).message).toContain("config.json");
      expect((err as Error).message).toContain("sha256");
    }
  });

  it("throws VERIFY naming the path on a size mismatch", async () => {
    const example = JSON.parse(readFileSync(exampleManifestPath, "utf8")) as {
      files: { path: string; size: number; sha256: string }[];
    };
    const hb = new HuggingBayClient({ fetch: createReplayFetch() });
    const lock = await hb.lock("hf-model-qwen-qwen2-5-7b-instruct");
    if (lock === null) throw new Error("expected lock");
    const tampered = {
      ...lock,
      files: lock.files.map((f) => (f.path === "README.md" ? { ...f, size: f.size + 1 } : f)),
    };
    try {
      crossCheck(example.files, tampered);
      expect.unreachable("expected VERIFY");
    } catch (err) {
      expect(err).toBeInstanceOf(EnspackError);
      expect((err as EnspackError).code).toBe("VERIFY");
      expect((err as Error).message).toContain("README.md");
      expect((err as Error).message).toContain("size");
    }
  });

  it("does not throw when HF has a path HB lacks, and throws when HB has a path HF lacks", () => {
    const files = [
      { path: "config.json", size: 1, sha256: "a".repeat(64), role: "config" as const },
    ];
    const hbOnly = {
      files: [
        { path: "config.json", size: 1, sha256: "a".repeat(64) },
        { path: "extra.bin", size: 2, sha256: "b".repeat(64) },
      ],
      raw: {},
    };
    try {
      crossCheck(files, hbOnly);
      expect.unreachable("expected VERIFY");
    } catch (err) {
      expect((err as EnspackError).code).toBe("VERIFY");
      expect((err as Error).message).toContain("extra.bin");
    }

    const hfExtra = [
      ...files,
      { path: "only-hf.txt", size: 3, sha256: "c".repeat(64), role: "doc" as const },
    ];
    expect(
      crossCheck(hfExtra, {
        files: files.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
        raw: {},
      }),
    ).toEqual({
      ok: true,
      compared: 1,
    });
  });
});
