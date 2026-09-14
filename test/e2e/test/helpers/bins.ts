import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cliDist } from "./paths.js";

export function resolveAnvilBin(): string | null {
  const fromHome = join(homedir(), ".foundry/bin/anvil");
  if (existsSync(fromHome)) {
    return fromHome;
  }
  for (const dir of (process.env.PATH ?? "").split(":")) {
    const candidate = join(dir, "anvil");
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function aria2cAvailable(): boolean {
  try {
    return spawnSync("aria2c", ["--version"], { encoding: "utf8" }).status === 0;
  } catch {
    return false;
  }
}

export const anvilBin = resolveAnvilBin();

export const cliBuilt = existsSync(cliDist);

export function killPid(proc: ChildProcess): void {
  const pid = proc.pid;
  if (pid === undefined || proc.exitCode !== null) {
    return;
  }
  try {
    proc.kill("SIGTERM");
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

export function spawnSeeder(args: string[]): ChildProcess {
  const child = spawn("aria2c", args, { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.resume();
  child.stderr?.resume();
  return child;
}
