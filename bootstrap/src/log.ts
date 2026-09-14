import type { Logger } from "./deps.js";

/** AGENTS.md: human logs go to stderr; never print keys or RPC URLs. */
export function stderrLogger(): Logger {
  return {
    info(message: string) {
      process.stderr.write(`${message}\n`);
    },
    warn(message: string) {
      process.stderr.write(`warning: ${message}\n`);
    },
  };
}
