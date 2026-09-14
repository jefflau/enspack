import { type ChildProcess, type SpawnOptions, spawn as defaultSpawn } from "node:child_process";
import { EnspackError } from "@enspack/core";
import type { Progress } from "@enspack/core";
import { parseAria2Progress, stripAnsi } from "./progress.js";

/** Test hook: `spawn(command, argv, options)` — never `shell: true`. */
export type SpawnImpl = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

const LINE_CAP = 20;

export interface RunAria2Options {
  command: string;
  args: string[];
  spawnImpl: SpawnImpl;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onLine?: (line: string) => void;
  onProgress?: (p: Progress) => void;
  /** Kill the child if no progress line arrives for this many ms. */
  stallTimeoutMs?: number;
}

function pushLine(buf: string[], line: string): void {
  const cleaned = stripAnsi(line).trimEnd();
  if (cleaned.length === 0) return;
  buf.push(cleaned);
  if (buf.length > LINE_CAP) buf.shift();
}

function killChild(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null) return;
  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }
  setTimeout(() => {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }, 2000).unref();
}

/** Spawn aria2c with an argv array (never a shell) and fail closed on non-zero exit. */
export function runAria2(opts: RunAria2Options): Promise<void> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new EnspackError("DOWNLOAD", "download aborted"));
      return;
    }

    const spawnOptions: SpawnOptions = {
      stdio: ["ignore", "pipe", "pipe"],
    };
    if (opts.env !== undefined) {
      spawnOptions.env = opts.env;
    }

    const child = opts.spawnImpl(opts.command, opts.args, spawnOptions);
    const lines: string[] = [];
    let settled = false;
    let leftoverOut = "";
    let leftoverErr = "";
    let lastActivity = Date.now();

    const fail = (err: EnspackError): void => {
      if (settled) return;
      settled = true;
      cleanup();
      killChild(child);
      reject(err);
    };

    const succeed = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const onAbort = (): void => {
      fail(new EnspackError("DOWNLOAD", "download aborted"));
    };

    const stallMs = opts.stallTimeoutMs;
    const stallTimer =
      stallMs !== undefined && stallMs > 0
        ? setInterval(() => {
            if (Date.now() - lastActivity > stallMs) {
              fail(
                new EnspackError(
                  "DOWNLOAD",
                  `aria2c stalled for ${Math.round(stallMs / 1000)}s\n${lines.slice(-LINE_CAP).join("\n")}`,
                ),
              );
            }
          }, 1000)
        : undefined;
    stallTimer?.unref();

    const handleChunk = (chunk: Buffer | string, leftover: string, fromErr: boolean): string => {
      const text = leftover + chunk.toString();
      const parts = text.split(/\r?\n/);
      const next = parts.pop() ?? "";
      for (const part of parts) {
        const line = stripAnsi(part);
        pushLine(lines, line);
        opts.onLine?.(line);
        const progress = parseAria2Progress(line);
        if (progress) {
          lastActivity = Date.now();
          opts.onProgress?.(progress);
        } else if (fromErr || line.length > 0) {
          lastActivity = Date.now();
        }
      }
      return next;
    };

    child.stdout?.on("data", (chunk: Buffer | string) => {
      leftoverOut = handleChunk(chunk, leftoverOut, false);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      leftoverErr = handleChunk(chunk, leftoverErr, true);
    });

    const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (leftoverOut) handleChunk("\n", leftoverOut, false);
      if (leftoverErr) handleChunk("\n", leftoverErr, true);
      if (settled) return;
      if (code === 0) {
        succeed();
        return;
      }
      const tail = lines.slice(-LINE_CAP).join("\n");
      fail(
        new EnspackError(
          "DOWNLOAD",
          `aria2c exited ${code ?? "null"}${signal ? ` signal=${signal}` : ""}\n${tail}`,
        ),
      );
    };

    child.on("close", onClose);
    child.on("error", (cause) => {
      fail(new EnspackError("DOWNLOAD", `failed to spawn ${opts.command}`, cause));
    });

    opts.signal?.addEventListener("abort", onAbort, { once: true });

    function cleanup(): void {
      opts.signal?.removeEventListener("abort", onAbort);
      if (stallTimer !== undefined) clearInterval(stallTimer);
    }
  });
}

export const nodeSpawn: SpawnImpl = defaultSpawn;
