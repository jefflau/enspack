import type { Progress } from "@enspack/core";

const SIZE_UNITS: Record<string, number> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
  K: 1024,
  M: 1024 ** 2,
  G: 1024 ** 3,
};

const ESC = String.fromCharCode(27);
const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function parseSize(n: string, unit: string): number {
  const mul = SIZE_UNITS[unit] ?? 1;
  return Math.round(Number(n) * mul);
}

/** Parse aria2c `--summary-interval` lines into SPEC/MVP `Progress`. */
export function parseAria2Progress(rawLine: string): Progress | undefined {
  const line = stripAnsi(rawLine).trim();
  const m = line.match(
    /\[#[0-9a-fA-F]+\s+(\d+(?:\.\d+)?)([KMGT]?i?B)\/(\d+(?:\.\d+)?)([KMGT]?i?B)\((\d+(?:\.\d+)?)%\)(?:\s+CN:(\d+))?(?:\s+SD:(\d+))?(?:\s+SEED:(\d+))?(?:\s+DL:(\d+(?:\.\d+)?)([KMGT]?i?B))?/i,
  );
  if (!m) return undefined;
  const doneStr = m[1];
  const doneUnit = m[2];
  const totalStr = m[3];
  const totalUnit = m[4];
  if (
    doneStr === undefined ||
    doneUnit === undefined ||
    totalStr === undefined ||
    totalUnit === undefined
  ) {
    return undefined;
  }
  const progress: Progress = {
    phase: "download",
    bytesDone: parseSize(doneStr, doneUnit),
    bytesTotal: parseSize(totalStr, totalUnit),
  };
  const peersRaw = m[6];
  if (peersRaw !== undefined) {
    progress.peers = Number(peersRaw);
  }
  const speedRaw = m[9];
  const speedUnit = m[10];
  if (speedRaw !== undefined && speedUnit !== undefined) {
    progress.speed = parseSize(speedRaw, speedUnit);
  }
  return progress;
}
