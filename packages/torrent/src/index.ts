export { Aria2Downloader } from "./downloader.js";
export type { Aria2DownloaderOptions, FetchOptions } from "./downloader.js";
export { httpFallbackSources } from "./http-fallback.js";
export {
  checkMagnet,
  createTorrent,
  infohash,
  injectWebseeds,
  magnetFor,
  metainfoMatchesManifest,
  parseTorrent,
} from "./metainfo.js";
export type {
  CreateTorrentOptions,
  CreateTorrentResult,
  ParsedTorrent,
  TorrentFile,
} from "./metainfo.js";
export type { SpawnImpl } from "./run.js";
export { Sha256Verifier } from "./verifier.js";
