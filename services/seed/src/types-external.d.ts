declare module "parse-torrent" {
  interface ParsedTorrent {
    infoHash?: string;
    name?: string;
    files?: { path: string; name: string; length: number; offset: number }[];
    length?: number;
    pieceLength?: number;
    urlList?: string[];
    announce?: string[];
  }

  function parseTorrent(input: Uint8Array | Buffer | string): Promise<ParsedTorrent>;
  export function toTorrentFile(parsed: ParsedTorrent): Uint8Array;
  export default parseTorrent;
}
