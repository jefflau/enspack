import { describe, expect, it } from "vitest";
import {
  TORRENT_MAX_BYTES,
  createManifestStore,
  fetchTorrentVerified,
  manifestCid,
} from "../../src/index.js";
import type { IpfsManifestStore, Manifest } from "../../src/index.js";
import { listen } from "./helpers.js";

const TORRENT_BYTES = new TextEncoder().encode(
  "d4:infod6:lengthi1e4:name5:a.txt12:piece lengthi16eee",
);

function manifestWithTorrent(torrent?: { cid?: string; url?: string }): Manifest {
  return {
    distribution: { torrent },
  } as Manifest;
}

describe("fetchTorrentVerified", () => {
  it("fetches via store.getVerified when distribution.torrent.cid is set", async () => {
    const cid = await manifestCid(TORRENT_BYTES);
    const calls: { cid: string; maxBytes?: number }[] = [];
    const store: IpfsManifestStore = {
      async getVerified(gotCid, opts) {
        const rec: { cid: string; maxBytes?: number } = { cid: gotCid };
        if (opts?.maxBytes !== undefined) {
          rec.maxBytes = opts.maxBytes;
        }
        calls.push(rec);
        return TORRENT_BYTES;
      },
      async put() {
        return cid;
      },
    };
    const got = await fetchTorrentVerified(store, manifestWithTorrent({ cid }));
    expect(got).toEqual(TORRENT_BYTES);
    expect(calls).toEqual([{ cid, maxBytes: TORRENT_MAX_BYTES }]);
  });

  it("plain-fetches distribution.torrent.url with the torrent byte cap", async () => {
    let sawUrl = false;
    const { origin } = await listen((req, res) => {
      sawUrl = req.url === "/file.torrent";
      res.writeHead(200);
      res.end(Buffer.from(TORRENT_BYTES));
    });
    const store = createManifestStore({ gateways: ["http://127.0.0.1/{cid}"] });
    const got = await fetchTorrentVerified(
      store,
      manifestWithTorrent({ url: `${origin}/file.torrent` }),
    );
    expect(sawUrl).toBe(true);
    expect(got).toEqual(TORRENT_BYTES);
  });

  it("returns null when torrent has neither cid nor url", async () => {
    const store = createManifestStore({ gateways: ["http://127.0.0.1/{cid}"] });
    expect(await fetchTorrentVerified(store, manifestWithTorrent())).toBeNull();
    expect(await fetchTorrentVerified(store, { distribution: {} } as Manifest)).toBeNull();
  });

  it("prefers cid over url", async () => {
    const cid = await manifestCid(TORRENT_BYTES);
    let fetchedUrl = false;
    const store: IpfsManifestStore = {
      async getVerified() {
        return TORRENT_BYTES;
      },
      async put() {
        return cid;
      },
    };
    const got = await fetchTorrentVerified(
      store,
      manifestWithTorrent({ cid, url: "http://127.0.0.1:9/file.torrent" }),
      async () => {
        fetchedUrl = true;
        return new Response("nope");
      },
    );
    expect(got).toEqual(TORRENT_BYTES);
    expect(fetchedUrl).toBe(false);
  });

  it("rejects an over-cap torrent URL with FETCH", async () => {
    const huge = Buffer.alloc(32 * 1024, 1);
    const { origin } = await listen((_req, res) => {
      res.writeHead(200, { "content-length": String(TORRENT_MAX_BYTES + 1) });
      res.end(huge);
    });
    const store = createManifestStore({ gateways: ["http://127.0.0.1/{cid}"] });
    await expect(
      fetchTorrentVerified(store, manifestWithTorrent({ url: `${origin}/file.torrent` })),
    ).rejects.toMatchObject({
      code: "FETCH",
      message: expect.stringMatching(/exceeds cap/),
    });
  });
});
