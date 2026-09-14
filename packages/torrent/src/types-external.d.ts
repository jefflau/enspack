declare module "create-torrent" {
  type Input =
    | string
    | NodeJS.ReadableStream
    | Uint8Array
    | Array<string | NodeJS.ReadableStream | Uint8Array>;

  interface CreateTorrentOptions {
    name?: string;
    comment?: string;
    createdBy?: string;
    creationDate?: Date | number;
    private?: boolean;
    pieceLength?: number;
    maxPieceLength?: number;
    announce?: string | string[];
    announceList?: string[][];
    urlList?: string | string[];
  }

  function createTorrent(
    input: Input,
    opts: CreateTorrentOptions,
    cb: (err: Error | null, torrent: Uint8Array) => void,
  ): void;

  export default createTorrent;
}

declare module "parse-torrent" {
  interface ParseTorrentFile {
    path: string;
    name: string;
    length: number;
    offset: number;
  }

  interface ParsedTorrent {
    infoHash: string;
    name: string;
    files: ParseTorrentFile[];
    length: number;
    pieceLength: number;
    urlList: string[];
    announce: string[];
    private?: boolean;
  }

  function parseTorrent(input: Uint8Array | Buffer | string): Promise<ParsedTorrent>;
  export function toTorrentFile(parsed: ParsedTorrent): Uint8Array;
  export default parseTorrent;
}

declare module "piece-length" {
  function calcPieceLength(bytes: number): number;
  export default calcPieceLength;
}
