import { join } from "node:path";
import { EnspackError } from "@enspack/core";
import { describe, expect, it } from "vitest";
import { baseDeps, runCli, withTmp } from "./helpers.js";

describe("get --http-only skips torrent metainfo (WP-22)", () => {
  it("succeeds when the torrent CID fetch throws FETCH, and get without --http-only fails", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest } = await baseDeps(tmp);
      const torrentCid = manifest.distribution.torrent?.cid;
      expect(torrentCid).toBeDefined();
      const inner = deps.store;
      deps.store = {
        async getVerified(cid: string) {
          if (cid === torrentCid) {
            throw new EnspackError("FETCH", `torrent CID ${cid} unavailable`);
          }
          return inner.getVerified(cid);
        },
        async put(bytes: Uint8Array) {
          return inner.put(bytes);
        },
      };

      const dir = join(tmp, "http-only");
      const httpOnly = await runCli(deps, [
        "get",
        manifest.model,
        "--dir",
        dir,
        "--http-only",
        "--json",
      ]);
      expect(httpOnly.code, httpOnly.stderr).toBe(0);
      expect(httpOnly.stderr).toContain("http-only: skipping metainfo");
      expect(JSON.parse(httpOnly.stdout)).toMatchObject({ verified: true });

      const torrentPath = await runCli(deps, [
        "get",
        manifest.model,
        "--dir",
        join(tmp, "torrent"),
        "--json",
      ]);
      expect(torrentPath.code).toBe(2);
      expect(torrentPath.stderr).toContain("torrent CID");
      expect(torrentPath.stderr).toContain("unavailable");
    });
  });
});
