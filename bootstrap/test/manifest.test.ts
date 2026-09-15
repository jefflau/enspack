import { SELF_CID_PLACEHOLDER } from "@enspack/core";
import { describe, expect, it } from "vitest";
import { assembleManifest } from "../src/manifest.js";
import { tinyModelFiles } from "./helpers.js";

const REAL_CID = `bafkrei${"b".repeat(52)}`;
const PREV_CID = `bafkrei${"c".repeat(52)}`;
const WEBSEED =
  "https://huggingface.co/enspack/tiny-model/resolve/abcdef1200000000000000000000000000000000/";

describe("assembleManifest versions[] cid (issue #30)", () => {
  it("uses SELF_CID_PLACEHOLDER for the current entry", () => {
    const manifest = assembleManifest({
      org: "enspack",
      repoName: "tiny-model",
      repo: "enspack/tiny-model",
      revision: "abcdef1200000000000000000000000000000000",
      license: "apache-2.0",
      displayName: "tiny-model",
      files: tinyModelFiles(),
      infohash: "0".repeat(40),
      magnet: `magnet:?xt=urn:btih:${"0".repeat(40)}`,
      torrentCid: SELF_CID_PLACEHOLDER,
      webseeds: [WEBSEED],
      version: "1.0.0",
      createdAt: "2026-09-14T00:00:00Z",
    });
    expect(manifest.versions).toHaveLength(1);
    expect(manifest.versions[0]?.cid).toBe(SELF_CID_PLACEHOLDER);
  });

  it("stamps the previous tail with previous CID and placeholders the new last entry", () => {
    const manifest = assembleManifest({
      org: "enspack",
      repoName: "tiny-model",
      repo: "enspack/tiny-model",
      revision: "abcdef1200000000000000000000000000000000",
      license: "apache-2.0",
      displayName: "tiny-model",
      files: tinyModelFiles(),
      infohash: "0".repeat(40),
      magnet: `magnet:?xt=urn:btih:${"0".repeat(40)}`,
      torrentCid: SELF_CID_PLACEHOLDER,
      webseeds: [WEBSEED],
      version: "1.1.0",
      createdAt: "2026-09-15T00:00:00Z",
      previous: PREV_CID,
      previousVersions: [
        {
          version: "1.0.0",
          name: "v1-0-0.enspack--tiny-model.mirrors.enspack.eth",
          cid: REAL_CID,
          createdAt: "2026-09-14T00:00:00Z",
        },
      ],
    });
    expect(manifest.versions).toHaveLength(2);
    expect(manifest.versions[0]?.cid).toBe(PREV_CID);
    expect(manifest.versions[1]?.cid).toBe(SELF_CID_PLACEHOLDER);
    expect(manifest.previous).toBe(PREV_CID);
  });
});
