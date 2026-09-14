import { EnspackError } from "../error.js";

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
 * SPEC §4 step 3 / MVP.md WP-03: read a response, aborting as soon as it exceeds `cap`.
 */
export async function readCappedBytes(res: Response, cap: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) {
    await res.body?.cancel().catch(() => undefined);
    throw new EnspackError("FETCH", `response exceeds cap of ${cap} bytes`);
  }

  if (res.body === null) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > cap) {
      throw new EnspackError("FETCH", `response exceeds cap of ${cap} bytes`);
    }
    return buf;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value === undefined) {
        continue;
      }
      received += value.byteLength;
      if (received > cap) {
        await reader.cancel().catch(() => undefined);
        throw new EnspackError("FETCH", `response exceeds cap of ${cap} bytes`);
      }
      chunks.push(value);
    }
  } catch (cause) {
    if (cause instanceof EnspackError) {
      throw cause;
    }
    await reader.cancel().catch(() => undefined);
    throw cause;
  }
  return concat(chunks, received);
}
