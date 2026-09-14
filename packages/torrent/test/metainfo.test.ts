import { readFileSync } from "node:fs";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnspackError, TORRENT_MAX_BYTES, validateManifest } from "@enspack/core";
import { describe, expect, it } from "vitest";
import { createTorrent, infohash, magnetFor, parseTorrent } from "../src/index.js";
import { injectWebseeds } from "../src/metainfo.js";
import { fixtureDir, fixtureFiles, manifestPath, torrentPath } from "./helpers/paths.js";

async function copyContent(dest: string): Promise<void> {
  for (const name of fixtureFiles) {
    await cp(join(fixtureDir, name), join(dest, name));
  }
}

describe("createTorrent / parseTorrent", () => {
  it("is deterministic: two runs give the same infohash", async () => {
    const dir = await mkdtemp(join(tmpdir(), "enspack-ct-"));
    try {
      await copyContent(dir);
      const a = await createTorrent(dir, {
        name: "tiny-model",
        webseeds: ["https://example.invalid/tiny-model/"],
      });
      const b = await createTorrent(dir, {
        name: "tiny-model",
        webseeds: ["https://example.invalid/tiny-model/"],
      });
      expect(a.infohash).toBe(b.infohash);
      expect(a.infohash).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("parseTorrent(createTorrent(...).metainfo).webseeds equals the input", async () => {
    const dir = await mkdtemp(join(tmpdir(), "enspack-ct-"));
    try {
      await copyContent(dir);
      const webseeds = [
        "https://example.invalid/tiny-model/",
        "https://huggingbay.example/tiny-model/",
      ];
      const created = await createTorrent(dir, { name: "tiny-model", webseeds });
      const parsed = await parseTorrent(created.metainfo);
      expect(parsed.webseeds).toEqual(webseeds);
      expect(parsed.infohash).toBe(created.infohash);
      expect(parsed.name).toBe("tiny-model");
      expect(parsed.files.map((f) => f.path)).toEqual([
        "tiny-model/config.json",
        "tiny-model/model.safetensors",
        "tiny-model/tokenizer.json",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("includes dotfiles such as .gitattributes in the file tree (SPEC §3)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "enspack-ct-"));
    try {
      await copyContent(dir);
      await writeFile(join(dir, ".gitattributes"), "*.safetensors filter=lfs\n");
      const created = await createTorrent(dir, {
        name: "tiny-model",
        webseeds: ["https://example.invalid/tiny-model/"],
      });
      expect(created.files.map((f) => f.path)).toEqual([
        ".gitattributes",
        "config.json",
        "model.safetensors",
        "tokenizer.json",
      ]);
      const parsed = await parseTorrent(created.metainfo);
      expect(parsed.files.map((f) => f.path)).toContain("tiny-model/.gitattributes");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("injectWebseeds merges url-list without changing the infohash", async () => {
    const original = readFileSync(torrentPath);
    const before = await parseTorrent(original);
    const merged = await injectWebseeds(original, ["https://mirror.example/tiny-model/"]);
    const after = await parseTorrent(merged);
    expect(after.infohash).toBe(before.infohash);
    expect(after.webseeds).toEqual([...before.webseeds, "https://mirror.example/tiny-model/"]);
  });

  it("rejects webseeds that do not end with /", async () => {
    const dir = await mkdtemp(join(tmpdir(), "enspack-ct-"));
    try {
      await copyContent(dir);
      await expect(
        createTorrent(dir, { webseeds: ["https://example.invalid/tiny-model"] }),
      ).rejects.toMatchObject({ code: "VERIFY" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("parseTorrent throws VERIFY on garbage", async () => {
    await expect(parseTorrent(new Uint8Array([1, 2, 3, 4]))).rejects.toBeInstanceOf(EnspackError);
    await expect(parseTorrent(new Uint8Array([1, 2, 3, 4]))).rejects.toMatchObject({
      code: "VERIFY",
    });
  });

  it("parseTorrent throws VERIFY when bytes exceed TORRENT_MAX_BYTES", async () => {
    const big = new Uint8Array(TORRENT_MAX_BYTES + 1);
    await expect(parseTorrent(big)).rejects.toMatchObject({ code: "VERIFY" });
  });

  it("committed fixture torrent matches createTorrent of the fixture files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "enspack-ct-"));
    try {
      await copyContent(dir);
      const created = await createTorrent(dir, {
        name: "tiny-model",
        webseeds: ["https://example.invalid/tiny-model/"],
        comment: "enspack tiny-model fixture",
      });
      const committed = await parseTorrent(new Uint8Array(readFileSync(torrentPath)));
      expect(created.infohash).toBe(committed.infohash);
      expect((await infohash(created.metainfo)).toLowerCase()).toBe(created.infohash);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fixture manifest validates and magnetFor matches MAGNET_RE", async () => {
    const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
    expect(manifest.distribution.infohash).toMatch(/^[0-9a-f]{40}$/);
    expect(magnetFor(manifest.distribution.infohash, "tiny-model")).toBe(
      manifest.distribution.magnet,
    );
  });
});

describe("magnetFor", () => {
  it("encodes dn and lowercases the infohash", () => {
    const hex = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(magnetFor(hex, "foo bar")).toBe(`magnet:?xt=urn:btih:${hex}&dn=foo%20bar`);
  });
});
