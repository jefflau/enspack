import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { infraRoot, readInfra } from "./helpers.js";

const LEAK_RE =
  /echo\s+["']?\$\{?(ENSPACK_OPERATOR_KEY|QBT_PASS|HF_TOKEN|SEPOLIA_RPC_URL|ETH_RPC_URL|ACME_EMAIL)/;

describe("deploy.sh and bootstrap-remote.sh", () => {
  const deploy = join(infraRoot, "deploy.sh");
  const bootstrap = join(infraRoot, "bootstrap-remote.sh");

  it("bash -n passes on both scripts", () => {
    for (const script of [deploy, bootstrap]) {
      const r = spawnSync("bash", ["-n", script], { encoding: "utf8" });
      expect(r.status, `${script}: ${r.stderr}`).toBe(0);
    }
  });

  it("deploy.sh refuses to run without a host arg", () => {
    const r = spawnSync("bash", [deploy], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/usage:/);
  });

  it("bootstrap-remote.sh refuses to run without a host arg", () => {
    const r = spawnSync("bash", [bootstrap], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/usage:/);
  });

  it("never echoes operator key / RPC / tokens (grep)", () => {
    const deploySrc = readInfra("deploy.sh");
    const bootSrc = readInfra("bootstrap-remote.sh");
    expect(deploySrc).not.toMatch(LEAK_RE);
    expect(bootSrc).not.toMatch(LEAK_RE);
    expect(deploySrc).not.toMatch(/echo\s+\$ENSPACK_OPERATOR_KEY/);
    expect(bootSrc).not.toMatch(/echo\s+\$ENSPACK_OPERATOR_KEY/);
    expect(deploySrc).not.toContain("set -x");
    expect(bootSrc).not.toContain("set -x");
    expect(deploySrc).toContain("BatchMode=yes");
    expect(bootSrc).toContain("BatchMode=yes");
    expect(deploySrc).toContain("SSH_KEY_FILE");
    expect(bootSrc).toContain("SSH_KEY_FILE");
  });
});
