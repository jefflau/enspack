import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";

function bencode(value: unknown): Buffer {
  if (typeof value === "number") {
    return Buffer.from(`i${Math.floor(value)}e`);
  }
  if (typeof value === "string") {
    return bencode(Buffer.from(value));
  }
  if (Buffer.isBuffer(value)) {
    return Buffer.concat([Buffer.from(`${value.length}:`), value]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([Buffer.from("l"), ...value.map(bencode), Buffer.from("e")]);
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts: Buffer[] = [Buffer.from("d")];
    for (const k of keys) {
      parts.push(bencode(k), bencode((value as Record<string, unknown>)[k]));
    }
    parts.push(Buffer.from("e"));
    return Buffer.concat(parts);
  }
  throw new Error("cannot bencode");
}

function compactPeer(ip: string, port: number): Buffer {
  const buf = Buffer.alloc(6);
  const parts = ip.split(".").map(Number);
  buf[0] = parts[0] ?? 127;
  buf[1] = parts[1] ?? 0;
  buf[2] = parts[2] ?? 0;
  buf[3] = parts[3] ?? 1;
  buf.writeUInt16BE(port, 4);
  return buf;
}

export interface TestTracker {
  url: string;
  close: () => Promise<void>;
}

/** BEP 3 HTTP tracker that always returns the seeder in compact form (WP-06 in-process approach). */
export function startTracker(seederIp: string, seederPort: number): Promise<TestTracker> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (!url.pathname.includes("announce")) {
        res.statusCode = 404;
        res.end();
        return;
      }
      const body = bencode({
        interval: 5,
        "min interval": 1,
        complete: 1,
        incomplete: 0,
        peers: compactPeer(seederIp, seederPort),
      });
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Content-Length", body.length);
      res.end(body);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}/announce`,
        close: () =>
          new Promise((r, j) => {
            server.close((err) => (err ? j(err) : r()));
          }),
      });
    });
  });
}
