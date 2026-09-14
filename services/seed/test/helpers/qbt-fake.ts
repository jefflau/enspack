import { parseTorrent } from "@enspack/torrent";
import { formPart, formPartText, listen, readRequestBody } from "./http.js";

export interface FakeQbtRequest {
  method: string;
  url: string;
  body: Buffer;
  contentType: string;
}

export interface FakeQbtTorrent {
  hash: string;
  state: string;
  progress: number;
  num_seeds: number;
  num_leechs: number;
  uploaded: number;
}

export interface FakeQbt {
  origin: string;
  requests: FakeQbtRequest[];
  addedTorrents: Buffer[];
  addedMagnets: string[];
  addedCategories: string[];
  addedTags: string[];
  torrents: Map<string, FakeQbtTorrent>;
  version: string;
  failLogin: boolean;
  setTorrent: (info: FakeQbtTorrent) => void;
}

/**
 * qBittorrent WebAPI stand-in on 127.0.0.1 (no network off-box).
 */
export async function startFakeQbt(): Promise<FakeQbt> {
  const fake: FakeQbt = {
    origin: "",
    requests: [],
    addedTorrents: [],
    addedMagnets: [],
    addedCategories: [],
    addedTags: [],
    torrents: new Map(),
    version: "v5.0.0",
    failLogin: false,
    setTorrent(info) {
      fake.torrents.set(info.hash.toLowerCase(), info);
    },
  };

  const { origin } = await listen(async (req, res) => {
    const url = req.url ?? "";
    const body = await readRequestBody(req);
    const contentType = req.headers["content-type"] ?? "";
    fake.requests.push({ method: req.method ?? "", url, body, contentType });

    if (url.startsWith("/api/v2/auth/login")) {
      if (fake.failLogin) {
        res.writeHead(403, { "content-type": "text/plain" });
        res.end("Fails.");
        return;
      }
      res.writeHead(200, {
        "content-type": "text/plain",
        "set-cookie": "SID=test-sid; HttpOnly; Path=/",
      });
      res.end("Ok.");
      return;
    }

    if (url.startsWith("/api/v2/app/version")) {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(fake.version);
      return;
    }

    if (url.startsWith("/api/v2/torrents/addWebSeeds")) {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("Ok.");
      return;
    }

    if (url.startsWith("/api/v2/torrents/add")) {
      const category = formPartText(body, "category");
      const tags = formPartText(body, "tags");
      const urls = formPartText(body, "urls");
      const torrents = formPart(body, "torrents");
      if (category !== undefined) fake.addedCategories.push(category);
      if (tags !== undefined) fake.addedTags.push(tags);
      if (urls !== undefined) fake.addedMagnets.push(urls);
      if (torrents !== undefined) {
        fake.addedTorrents.push(torrents);
        try {
          const parsed = await parseTorrent(new Uint8Array(torrents));
          fake.setTorrent({
            hash: parsed.infohash,
            state: "downloading",
            progress: 0,
            num_seeds: 0,
            num_leechs: 0,
            uploaded: 0,
          });
        } catch {
          // leave unparsed; tests that need infohash set it themselves
        }
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("Ok.");
      return;
    }

    if (url.startsWith("/api/v2/torrents/info")) {
      const u = new URL(url, "http://127.0.0.1");
      const hashes = (u.searchParams.get("hashes") ?? "").toLowerCase();
      const found = fake.torrents.get(hashes);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(found === undefined ? [] : [found]));
      return;
    }

    res.writeHead(404);
    res.end("unknown");
  });

  fake.origin = origin;
  return fake;
}
