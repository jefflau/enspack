import { existsSync, readFileSync } from "node:fs";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateManifest } from "@enspack/core";
import { afterEach, describe, expect, it } from "vitest";
import { Sha256Verifier } from "../src/index.js";
import { fixtureDir, fixtureFiles, manifestPath } from "./helpers/paths.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function copyFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "enspack-ver-"));
  dirs.push(dir);
  for (const name of fixtureFiles) {
    await cp(join(fixtureDir, name), join(dir, name));
  }
  return dir;
}

describe("Sha256Verifier", () => {
  it("returns { ok: true } for the intact fixture", async () => {
    const dir = await copyFixture();
    const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
    const result = await new Sha256Verifier().verify(manifest, dir);
    expect(result).toEqual({ ok: true });
  });

  it("corruption: flipped byte → sha256; truncate → size; delete → missing; quarantine", async () => {
    const verifier = new Sha256Verifier();
    const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")));

    const flipped = await copyFixture();
    const modelPath = join(flipped, "model.safetensors");
    const buf = Buffer.from(readFileSync(modelPath));
    const last = buf.length - 1;
    buf[last] = (buf[last] ?? 0) ^ 0xff;
    await writeFile(modelPath, buf);
    const sha = await verifier.verify(manifest, flipped);
    expect(sha).toEqual({
      ok: false,
      failures: [{ path: "model.safetensors", reason: "sha256" }],
    });
    expect(JSON.stringify(sha)).toContain("model.safetensors");

    const truncated = await copyFixture();
    const tbuf = Buffer.from(readFileSync(join(truncated, "model.safetensors")));
    await writeFile(join(truncated, "model.safetensors"), tbuf.subarray(0, tbuf.length - 1));
    const size = await verifier.verify(manifest, truncated);
    expect(size).toEqual({
      ok: false,
      failures: [{ path: "model.safetensors", reason: "size" }],
    });

    const missing = await copyFixture();
    await rm(join(missing, "model.safetensors"));
    const miss = await verifier.verify(manifest, missing);
    expect(miss).toEqual({
      ok: false,
      failures: [{ path: "model.safetensors", reason: "missing" }],
    });

    if (sha.ok) throw new Error("expected failure");
    const q = await verifier.quarantine(flipped, manifest.distribution.infohash, sha.failures);
    expect(q).toBe(join(flipped, ".enspack-quarantine", manifest.distribution.infohash));
    expect(existsSync(join(q, "model.safetensors"))).toBe(true);
    expect(existsSync(join(flipped, "model.safetensors"))).toBe(false);
    expect(sha.failures.map((f) => f.path).join(" ")).toContain("model.safetensors");
  });
});
