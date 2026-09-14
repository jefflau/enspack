import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TestWebseed {
  url: string;
  close: () => Promise<void>;
}

function selfSignedTls(): { key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), "enspack-e2e-tls-"));
  const key = join(dir, "key.pem");
  const cert = join(dir, "cert.pem");
  const r = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-nodes",
      "-subj",
      "/CN=127.0.0.1",
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    throw new Error(`openssl failed: ${r.stderr}`);
  }
  return { key: readFileSync(key, "utf8"), cert: readFileSync(cert, "utf8") };
}

/**
 * HTTPS webseed: serve fixture files at `/{file}` and `/{top}/{file}` so both
 * BEP 19 (aria2c appends the torrent name) and HTTP-only (`webseed + path`) work.
 * Schema requires `https://` webseeds.
 */
export function startHttpsWebseed(root: string, topName = "tiny-model"): Promise<TestWebseed> {
  const tls = selfSignedTls();
  return new Promise((resolve, reject) => {
    const server = createHttpsServer({ key: tls.key, cert: tls.cert }, (req, res) => {
      const u = new URL(req.url ?? "/", "https://127.0.0.1");
      let rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
      if (rel.startsWith(`${topName}/`)) {
        rel = rel.slice(topName.length + 1);
      }
      const abs = join(root, rel);
      if (!abs.startsWith(root) || !existsSync(abs)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      const buf = readFileSync(abs);
      res.statusCode = 200;
      res.setHeader("content-length", buf.length);
      res.setHeader("content-type", "application/octet-stream");
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(buf);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `https://127.0.0.1:${addr.port}/`,
        close: () =>
          new Promise((r, j) => {
            server.close((err) => (err ? j(err) : r()));
          }),
      });
    });
  });
}
