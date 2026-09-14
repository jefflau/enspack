import { spawn } from "node:child_process";
import { enspackBin } from "./paths.js";

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function spawnCli(
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  timeoutMs = 120_000,
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [enspackBin, ...args], {
      env,
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`enspack ${args.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => {
      out.push(c);
    });
    child.stderr.on("data", (c: Buffer) => {
      err.push(c);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
  });
}

export function lastJsonObject(stdout: string): unknown {
  const line = stdout
    .trim()
    .split("\n")
    .filter((l) => l.trim().startsWith("{") || l.trim().startsWith("["))
    .at(-1);
  if (line === undefined) {
    throw new Error(`no JSON on stdout: ${JSON.stringify(stdout)}`);
  }
  return JSON.parse(line);
}
