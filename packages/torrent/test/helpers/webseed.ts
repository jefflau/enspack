import { readFileSync, statSync } from "node:fs";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join, normalize, relative, sep } from "node:path";

export interface TestWebseed {
  url: string;
  close: () => Promise<void>;
}

/**
 * Serve fixture files at `/{file}` and `/{top}/{file}` so both BEP 19
 * (aria2c appends the torrent name) and HTTP-only (`webseed + path`) work.
 */
export function startWebseed(root: string, topName = "tiny-model"): Promise<TestWebseed> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.statusCode = 405;
        res.end();
        return;
      }
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      let rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
      if (rel.startsWith(`${topName}/`)) {
        rel = rel.slice(topName.length + 1);
      }
      const abs = normalize(join(root, rel));
      const relToRoot = relative(root, abs);
      if (relToRoot.startsWith("..") || relToRoot.split(sep).includes("..")) {
        res.statusCode = 403;
        res.end();
        return;
      }
      try {
        const st = statSync(abs);
        if (!st.isFile()) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const buf = readFileSync(abs);
        res.statusCode = 200;
        res.setHeader("Content-Length", buf.length);
        res.setHeader("Content-Type", "application/octet-stream");
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        res.end(buf);
      } catch {
        res.statusCode = 404;
        res.end();
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}/`,
        close: () =>
          new Promise((r, j) => {
            server.close((err) => (err ? j(err) : r()));
          }),
      });
    });
  });
}
