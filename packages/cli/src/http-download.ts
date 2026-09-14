import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { EnspackError, type Manifest, type Progress, matchesSelect } from "@enspack/core";

/**
 * SPEC §4 step 7c: `--http-only` multi-source HTTP via fetch (hosts are untrusted;
 * SHA-256 is checked later). Used so TLS options follow Node, not aria2c.
 */
export async function httpOnlyFetch(
  manifest: Manifest,
  dest: string,
  opts: {
    select?: string[];
    onProgress?: (p: Progress) => void;
    fetchImpl?: typeof fetch;
  },
): Promise<void> {
  await mkdir(dest, { recursive: true });
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const files = manifest.files.filter((f) => matchesSelect(f.path, opts.select));
  if (files.length === 0) {
    throw new EnspackError("VERIFY", `no files matched select ${JSON.stringify(opts.select)}`);
  }
  const total = files.reduce((s, f) => s + f.size, 0);
  let done = 0;
  opts.onProgress?.({ phase: "download", bytesDone: 0, bytesTotal: total });
  for (const file of files) {
    const sources = manifest.distribution.webseeds.map((ws) => `${ws}${file.path}`);
    if (sources.length === 0) {
      throw new EnspackError("DOWNLOAD", `no webseeds for ${file.path}`);
    }
    let bytes: Uint8Array | undefined;
    let lastErr: unknown;
    for (const url of sources) {
      try {
        const res = await fetchImpl(url);
        if (!res.ok) {
          lastErr = new EnspackError("DOWNLOAD", `HTTP ${res.status} for ${file.path}`);
          continue;
        }
        bytes = new Uint8Array(await res.arrayBuffer());
        break;
      } catch (cause) {
        lastErr = cause;
      }
    }
    if (bytes === undefined) {
      throw new EnspackError("DOWNLOAD", `failed to fetch ${file.path}`, lastErr);
    }
    const abs = join(dest, file.path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
    done += bytes.byteLength;
    opts.onProgress?.({ phase: "download", bytesDone: done, bytesTotal: total, path: file.path });
  }
}
