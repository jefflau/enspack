import { type IncomingMessage, type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { manifestCid } from "@enspack/core";

export interface LocalPinnerGateway {
  origin: string;
  gatewayTemplate: string;
  close: () => Promise<void>;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Loopback HTTP pinner/gateway: stores raw blocks by CID and serves `GET /ipfs/<cid>`.
 * `POST /pin` accepts the block bytes and returns `{ cid }` matching `manifestCid`.
 */
export function startPinnerGateway(): Promise<LocalPinnerGateway> {
  const blobs = new Map<string, Uint8Array>();
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      void (async () => {
        const u = new URL(req.url ?? "/", "http://127.0.0.1");
        if (req.method === "POST" && u.pathname === "/pin") {
          const body = await readBody(req);
          const cid = await manifestCid(body);
          blobs.set(cid, body);
          const payload = JSON.stringify({ cid });
          res.statusCode = 201;
          res.setHeader("content-type", "application/json");
          res.setHeader("content-length", Buffer.byteLength(payload));
          res.end(payload);
          return;
        }
        const m = u.pathname.match(/^\/ipfs\/([^/]+)/);
        const cid = m?.[1];
        const bytes = cid !== undefined ? blobs.get(cid) : undefined;
        if (bytes === undefined) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.statusCode = 200;
        res.setHeader("content-type", "application/vnd.ipld.raw");
        res.setHeader("content-length", bytes.byteLength);
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        res.end(Buffer.from(bytes));
      })().catch(() => {
        res.statusCode = 500;
        res.end();
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      const origin = `http://127.0.0.1:${addr.port}`;
      resolve({
        origin,
        gatewayTemplate: `${origin}/ipfs/{cid}`,
        close: () =>
          new Promise((r, j) => {
            server.close((err) => (err ? j(err) : r()));
          }),
      });
    });
  });
}
