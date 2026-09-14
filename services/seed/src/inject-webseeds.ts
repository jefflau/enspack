import parseTorrentLib, { toTorrentFile } from "parse-torrent";

/**
 * SPEC §3 / MVP.md WP-09: merge BEP 19 webseeds into `url-list` (outside `info`, infohash unchanged).
 *
 * `@enspack/torrent` implements this as `injectWebseeds` but does not export it (see WP-09 note).
 */
export async function injectWebseeds(bytes: Uint8Array, webseeds: string[]): Promise<Uint8Array> {
  if (webseeds.length === 0) return bytes;
  const parsed = await parseTorrentLib(Buffer.from(bytes));
  const existing = parsed.urlList ?? [];
  if (webseeds.every((url) => existing.includes(url))) return bytes;
  parsed.urlList = [...new Set([...existing, ...webseeds])];
  return toTorrentFile(parsed);
}
