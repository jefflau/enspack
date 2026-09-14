import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { SpawnImpl } from "../../src/run.js";

export interface SpawnCall {
  command: string;
  args: string[];
  options: SpawnOptions;
}

export function fakeSpawn(exitCode = 0, stdout = ""): { spawnImpl: SpawnImpl; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawnImpl: SpawnImpl = (command, args, options) => {
    calls.push({ command, args: [...args], options: { ...options } });
    const child = new EventEmitter() as unknown as ChildProcess;
    Object.assign(child, {
      stdout: Readable.from([stdout]),
      stderr: Readable.from([]),
      killed: false,
      pid: 4242,
      exitCode: null,
      kill: () => {
        Object.assign(child, { killed: true, exitCode: 1 });
        queueMicrotask(() => child.emit("close", 1, "SIGTERM"));
        return true;
      },
    });
    queueMicrotask(() => {
      Object.assign(child, { exitCode });
      child.emit("close", exitCode, null);
    });
    return child;
  };
  return { spawnImpl, calls };
}
