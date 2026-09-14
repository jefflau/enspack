import http from "node:http";
import type { AddressInfo } from "node:net";
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

/** Pull one multipart form-data part (binary-safe). */
export function formPart(body: Buffer, name: string): Buffer | undefined {
  const needle = Buffer.from(`name="${name}"`);
  const idx = body.indexOf(needle);
  if (idx === -1) return undefined;
  const headerEnd = body.indexOf("\r\n\r\n", idx);
  if (headerEnd === -1) return undefined;
  const from = headerEnd + 4;
  const end = body.indexOf("\r\n--", from);
  if (end === -1) return body.subarray(from);
  return body.subarray(from, end);
}

export function formPartText(body: Buffer, name: string): string | undefined {
  const part = formPart(body, name);
  return part === undefined ? undefined : part.toString("utf8");
}
