import { EnspackError } from "@enspack/core";

/**
 * FLEET.md / BOOTSTRAP.md: refuse mainnet unless explicitly allowed and interactive.
 * Agents never set `ENSPACK_BOOTSTRAP_ALLOW_MAINNET` and never have a TTY.
 */
export function assertChainAllowed(
  chain: "mainnet" | "sepolia",
  env: NodeJS.ProcessEnv,
  interactive: boolean,
): void {
  if (chain !== "mainnet") return;
  if (env.ENSPACK_BOOTSTRAP_ALLOW_MAINNET !== "1") {
    throw new EnspackError(
      "POLICY",
      "mainnet is refused unless ENSPACK_BOOTSTRAP_ALLOW_MAINNET=1 (agents never run mainnet)",
    );
  }
  if (!interactive) {
    throw new EnspackError(
      "POLICY",
      "mainnet is refused unless the process is interactive (stdin is a TTY)",
    );
  }
}

export function isInteractive(stdin: { isTTY?: boolean } = process.stdin): boolean {
  return stdin.isTTY === true;
}
