import { EXIT_CODES } from "@enspack/core";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { assertChainAllowed } from "../src/guard.js";

describe("mainnet guard (FLEET.md / BOOTSTRAP.md)", () => {
  it("run --chain mainnet without ENSPACK_BOOTSTRAP_ALLOW_MAINNET=1 is POLICY", async () => {
    const env = { ...process.env };
    delete env.ENSPACK_BOOTSTRAP_ALLOW_MAINNET;
    let fetches = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetches += 1;
      return orig(...args);
    }) as typeof fetch;
    try {
      const stderr: string[] = [];
      const code = await runCli(["run", "--chain", "mainnet"], {
        env,
        interactive: false,
        io: {
          stdout: { write() {} },
          stderr: { write(s) { stderr.push(s); } },
        },
      });
      expect(code).toBe(EXIT_CODES.POLICY);
      expect(stderr.join("")).toMatch(/POLICY/);
      expect(fetches).toBe(0);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("assertChainAllowed throws POLICY without the env flag", () => {
    expect(() => assertChainAllowed("mainnet", {}, false)).toThrow(/POLICY|mainnet/);
    expect(() => assertChainAllowed("sepolia", {}, false)).not.toThrow();
  });
});
