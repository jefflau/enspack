import { describe, expect, it } from "vitest";
import { baseDeps, runCli, withTmp } from "./helpers.js";

const COMMANDS = [
  [],
  ["get"],
  ["inspect"],
  ["versions"],
  ["verify"],
  ["add"],
  ["install"],
  ["update"],
  ["publish"],
  ["ens-setup"],
  ["seed"],
] as const;

describe("help", () => {
  it("snapshots --help for the root and every command", async () => {
    await withTmp(async (tmp) => {
      const { deps } = await baseDeps(tmp);
      for (const cmd of COMMANDS) {
        const argv = cmd.length === 0 ? ["--help"] : [...cmd, "--help"];
        const { code, stdout, stderr } = await runCli(deps, argv);
        expect(code, argv.join(" ")).toBe(0);
        expect(stdout, argv.join(" ")).toBe("");
        expect(stderr, argv.join(" ")).toMatchSnapshot(cmd.length === 0 ? "root" : cmd[0]);
      }
    });
  });
});
