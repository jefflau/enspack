import { readFileSync } from "node:fs";
import { EnspackError, validateManifest } from "@enspack/core";
import { describe, expect, it } from "vitest";
import { metainfoMatchesManifest, parseTorrent } from "../src/index.js";
import { manifestPath, torrentPath } from "./helpers/paths.js";

describe("metainfoMatchesManifest", () => {
  it("accepts the tiny-model fixture", async () => {
    const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
    const parsed = await parseTorrent(new Uint8Array(readFileSync(torrentPath)));
    expect(() => metainfoMatchesManifest(parsed, manifest)).not.toThrow();
  });

  it("rejects a torrent with an extra file", async () => {
    const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
    const parsed = await parseTorrent(new Uint8Array(readFileSync(torrentPath)));
    const extra = {
      ...parsed,
      files: [...parsed.files, { path: `${parsed.name}/bonus.bin`, size: 1 }],
    };
    expect(() => metainfoMatchesManifest(extra, manifest)).toThrow(EnspackError);
    try {
      metainfoMatchesManifest(extra, manifest);
    } catch (e) {
      expect(e).toMatchObject({ code: "VERIFY" });
      expect((e as EnspackError).message).toContain("bonus.bin");
    }
  });

  it("rejects a torrent with a different size", async () => {
    const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
    const parsed = await parseTorrent(new Uint8Array(readFileSync(torrentPath)));
    const first = parsed.files[0];
    if (first === undefined) throw new Error("empty torrent");
    const resized = {
      ...parsed,
      files: parsed.files.map((f, i) => (i === 0 ? { ...f, size: f.size + 1 } : f)),
    };
    try {
      metainfoMatchesManifest(resized, manifest);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toMatchObject({ code: "VERIFY" });
      expect((e as EnspackError).message).toContain("size mismatch");
    }
  });
});
