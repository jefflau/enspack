import { type ChildProcess, spawn } from "node:child_process";
import { spawnSync } from "node:child_process";

export function aria2cAvailable(): boolean {
  try {
    const r = spawnSync("aria2c", ["--version"], { encoding: "utf8" });
    return r.status === 0;
  } catch {
    return false;
  }
}

export function killChild(child: ChildProcess): void {
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

export function spawnSeeder(args: string[]): ChildProcess {
  const child = spawn("aria2c", args, { stdio: ["ignore", "pipe", "pipe"] });
  // Drain output so a long seed never blocks on a full pipe.
  child.stdout?.resume();
  child.stderr?.resume();
  return child;
}
