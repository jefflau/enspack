import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cliBuilt } from "./helpers/bins.js";
import { spawnCli } from "./helpers/cli.js";
import { repoRoot } from "./helpers/paths.js";

describe("cli --help (docs flags)", () => {
  it.skipIf(!cliBuilt)("prints --help for every command against the built binary", async () => {
    const commands = [
      [],
      ["get"],
      ["inspect"],
      ["versions"],
      ["verify"],
      ["add"],
      ["install"],
      ["update"],
      ["publish"],
      ["seed"],
    ];
    for (const cmd of commands) {
      const argv = cmd.length === 0 ? ["--help"] : [...cmd, "--help"];
      const r = await spawnCli(argv, { ...process.env }, repoRoot, 15_000);
      expect(r.code, `${argv.join(" ")}\n${r.stderr}`).toBe(0);
      expect(r.stdout).toBe("");
      expect(r.stderr).toMatch(/Usage: enspack/);
    }
  });
});

describe("nightly workflow", () => {
  it("exists with cron 03:00 UTC, workflow_dispatch, and the e2e filter", () => {
    const path = `${repoRoot}/.github/workflows/e2e-nightly.yml`;
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toMatch(/cron:\s*["']0 3 \* \* \*["']/);
    expect(text).toContain("workflow_dispatch");
    expect(text).toContain("pnpm --filter @enspack/e2e test");
    expect(text).toContain("SEPOLIA_RPC_URL");
    expect(text).toContain("ENSPACK_PUBLISHER_KEY");
    expect(text).toContain("ENSPACK_SEED_NODE");
    expect(text).toContain("ENSPACK_KUBO_API");
  });
});
