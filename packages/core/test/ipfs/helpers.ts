import http from "node:http";
import type { AddressInfo } from "node:net";
import * as dagPb from "@ipld/dag-pb";
import { UnixFS } from "ipfs-unixfs";
import { CID } from "multiformats/cid";
import { sha256 } from "multiformats/hashes/sha2";
import { afterEach } from "vitest";

const servers: http.Server[] = [];

afterEach(async () => {
  const closing = servers.splice(0);
  await Promise.all(
    closing.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((err) => {
            if (err && (err as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
              reject(err);
              return;
            }
            resolve();
          });
        }),
    ),
  );
});

export async function listen(
  handler: http.RequestListener,
): Promise<{ origin: string; port: number; server: http.Server }> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo | null;
  if (addr === null) {
    throw new Error("server has no address");
  }
  return { origin: `http://127.0.0.1:${addr.port}`, port: addr.port, server };
}

export async function readRequestBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export function gatewayTemplate(origin: string): string {
  return `${origin}/ipfs/{cid}`;
}

export async function unixfsFileBlock(
  data: Uint8Array,
): Promise<{ cid: string; bytes: Uint8Array }> {
  const file = new UnixFS({ type: "file", data });
  const encoded = dagPb.encode(dagPb.createNode(file.marshal(), []));
  const digest = await sha256.digest(encoded);
  const cid = CID.createV1(dagPb.code, digest);
  return { cid: cid.toString(), bytes: encoded };
}

export async function unixfsDirectoryBlock(
  childCid: CID,
  childSize: number,
): Promise<{ cid: string; bytes: Uint8Array }> {
  const dir = new UnixFS({ type: "directory" });
  const encoded = dagPb.encode({
    Data: dir.marshal(),
    Links: [{ Name: "child", Tsize: childSize, Hash: childCid as never }],
  });
  const digest = await sha256.digest(encoded);
  const cid = CID.createV1(dagPb.code, digest);
  return { cid: cid.toString(), bytes: encoded };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
