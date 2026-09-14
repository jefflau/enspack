import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EXIT_CODES,
  EnspackError,
  hfCacheRepoDir,
  isEnspackError,
  validateManifest,
} from "../src/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("EnspackError", () => {
  it("sets name, code, message, and optional cause", () => {
    const cause = new Error("root");
    const err = new EnspackError("VERIFY", "hash mismatch", cause);
    expect(err.name).toBe("EnspackError");
    expect(err.code).toBe("VERIFY");
    expect(err.message).toBe("hash mismatch");
    expect(err.cause).toBe(cause);
    expect(isEnspackError(err)).toBe(true);
    expect(isEnspackError(new Error("nope"))).toBe(false);
  });

  it("maps codes to WP-08 exit codes", () => {
    expect(EXIT_CODES).toEqual({
      RESOLVE: 2,
      FETCH: 2,
      VERIFY: 3,
      LOCK: 3,
      DOWNLOAD: 4,
      PUBLISH: 5,
      POLICY: 5,
    });
  });
});

describe("hfCacheRepoDir", () => {
  it("uses models--{org}--{repo} from upstream.repo", () => {
    const raw: unknown = JSON.parse(
      readFileSync(join(repoRoot, "examples/qwen--qwen2-5-7b-instruct.enspack.json"), "utf8"),
    );
    const manifest = validateManifest(raw);
    expect(hfCacheRepoDir(manifest)).toBe("models--Qwen--Qwen2.5-7B-Instruct");
  });

  it("falls back to models--enspack--{model-label} when upstream is absent", () => {
    const raw = JSON.parse(
      readFileSync(join(repoRoot, "examples/qwen--qwen2-5-7b-instruct.enspack.json"), "utf8"),
    ) as Record<string, unknown>;
    const rest = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "upstream"));
    const manifest = validateManifest(rest);
    expect(hfCacheRepoDir(manifest)).toBe("models--enspack--qwen--qwen2-5-7b-instruct");
  });
});
