import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, manifestCid, readLock, validateLock } from "@enspack/core";
import { describe, expect, it } from "vitest";
import { baseDeps, fakeResolver, runCli, withTmp } from "./helpers.js";

describe("lockfile flows", () => {
  it("add writes a schema-valid enspack.lock", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest, cid } = await baseDeps(tmp);
      const { code } = await runCli(deps, ["add", manifest.model]);
      expect(code).toBe(0);
      const raw = await readFile(join(tmp, "enspack.lock"), "utf8");
      const lock = validateLock(JSON.parse(raw));
      expect(lock.lockfileVersion).toBe(1);
      expect(lock.models[manifest.model]?.cid).toBe(cid);
      expect(lock.models[manifest.model]?.resolved).toBe(manifest.name);
    });
  });

  it("install reproduces after add", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest } = await baseDeps(tmp);
      expect((await runCli(deps, ["add", manifest.model])).code).toBe(0);
      const dir = join(tmp, "out");
      const { code } = await runCli(deps, ["install", "--dir", dir, "--http-only"]);
      expect(code).toBe(0);
      const config = await readFile(join(dir, "config.json"));
      expect(config.byteLength).toBeGreaterThan(0);
    });
  });

  it("install after a different CID fails with 3", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest } = await baseDeps(tmp);
      expect((await runCli(deps, ["add", manifest.model])).code).toBe(0);
      const other = await manifestCid(canonicalJson({ ...manifest, displayName: "other" }));
      deps.resolverFactory = fakeResolver(manifest, other);
      const { code, stderr } = await runCli(deps, [
        "install",
        "--dir",
        join(tmp, "out"),
        "--http-only",
      ]);
      expect(code).toBe(3);
      expect(stderr).toMatch(/enspack update|pins/);
    });
  });

  it("--frozen refuses to write", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest } = await baseDeps(tmp);
      expect((await runCli(deps, ["add", manifest.model])).code).toBe(0);
      const before = await readFile(join(tmp, "enspack.lock"));
      const { code } = await runCli(deps, [
        "install",
        "--frozen",
        "--dir",
        join(tmp, "out"),
        "--http-only",
      ]);
      expect(code).toBe(0);
      const after = await readFile(join(tmp, "enspack.lock"));
      expect(after.equals(before)).toBe(true);

      const missing = await withTmp(async (empty) => {
        const again = await baseDeps(empty);
        return runCli(again.deps, ["install", "--frozen"]);
      });
      expect(missing.code).toBe(3);
      expect(missing.stderr).toMatch(/frozen|missing/);
    });
  });

  it("update rewrites the entry", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest, cid } = await baseDeps(tmp);
      expect((await runCli(deps, ["add", manifest.model])).code).toBe(0);
      const otherCid = `bafkrei${"c".repeat(52)}`;
      deps.resolverFactory = fakeResolver(manifest, otherCid);
      const { code } = await runCli(deps, ["update", manifest.model]);
      expect(code).toBe(0);
      const lock = await readLock(join(tmp, "enspack.lock"));
      expect(lock.models[manifest.model]?.cid).toBe(otherCid);
      expect(lock.models[manifest.model]?.cid).not.toBe(cid);
    });
  });
});
