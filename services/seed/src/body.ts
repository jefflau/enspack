import { EnspackError } from "@enspack/core";

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * MVP.md §4.2 / WP-03: reject when `content-length` exceeds `cap`, then stream-cap the body.
 */
export async function readCappedRequest(req: Request, cap: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) {
    await req.body?.cancel().catch(() => undefined);
    throw new EnspackError("PUBLISH", `body exceeds cap of ${cap} bytes`);
  }

  if (req.body === null) {
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.byteLength > cap) {
      throw new EnspackError("PUBLISH", `body exceeds cap of ${cap} bytes`);
    }
    return buf;
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      received += value.byteLength;
      if (received > cap) {
        await reader.cancel().catch(() => undefined);
        throw new EnspackError("PUBLISH", `body exceeds cap of ${cap} bytes`);
      }
      chunks.push(value);
    }
  } catch (cause) {
    if (cause instanceof EnspackError) throw cause;
    await reader.cancel().catch(() => undefined);
    throw cause;
  }
  return concat(chunks, received);
}

export function mediaType(contentType: string | undefined): string | undefined {
  if (contentType === undefined || contentType === "") return undefined;
  const type = contentType.split(";", 1)[0];
  return type?.trim().toLowerCase();
}
