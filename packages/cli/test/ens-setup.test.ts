import { type EnsSetupPlan, type EnsSetupResult, EnspackError } from "@enspack/core";
import { describe, expect, it } from "vitest";
import type { EnsSetupHandle } from "../src/types.js";
import { baseDeps, runCli, withTmp } from "./helpers.js";

const PENDING = "0xdefa17a1defa17a1defa17a1defa17a1defa17a1" as const;
const OPERATOR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const ACCOUNT0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;
const FACTORY = "0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef" as const;
const PARENT = "0x1111111111111111111111111111111111111111" as const;

function freshPlan(): EnsSetupPlan {
  const steps: EnsSetupPlan["steps"] = [
    {
      to: FACTORY,
      data: "0x",
      description:
        "VerifiableFactory.deployProxy(PermissionedResolverImpl, salt=enspack:resolver:enspack.eth)",
    },
    {
      to: PARENT,
      data: "0x",
      description: "setResolver(enspack → <pending proxy>)",
    },
    {
      to: FACTORY,
      data: "0x",
      description:
        "VerifiableFactory.deployProxy(UserRegistryImpl, salt=enspack:registry:enspack.eth)",
    },
    {
      to: PARENT,
      data: "0x",
      description: "setSubregistry(enspack → <pending proxy>)",
    },
    {
      to: PENDING,
      data: "0x",
      description: "setParent(0x1111111111111111111111111111111111111111, enspack)",
    },
    {
      to: PENDING,
      data: "0x",
      description: `grantRootRoles(REGISTRAR|RENEW, ${OPERATOR})`,
    },
    {
      to: PENDING,
      data: "0x",
      description: `authorizeNameRoles(dnsEncode(""), SET_TEXT|SET_CONTENTHASH, ${OPERATOR}, true)`,
    },
    {
      to: PENDING,
      data: "0x",
      description: "Registry.register(mirrors under enspack.eth)",
    },
    {
      to: FACTORY,
      data: "0x",
      description:
        "VerifiableFactory.deployProxy(UserRegistryImpl, salt=enspack:registry:mirrors.enspack.eth)",
    },
    {
      to: PENDING,
      data: "0x",
      description: "setSubregistry(mirrors → <pending proxy>)",
    },
    {
      to: PENDING,
      data: "0x",
      description: `grantRootRoles(REGISTRAR|RENEW, ${OPERATOR}) on mirrors.enspack.eth`,
    },
  ];
  return {
    name: "enspack.eth",
    account: ACCOUNT0,
    operator: OPERATOR,
    steps,
    already: [],
    ops: [],
    slots: {},
    resolver: PENDING,
    registry: PENDING,
    subnames: [{ name: "mirrors.enspack.eth", label: "mirrors", registry: PENDING }],
  };
}

function donePlan(): EnsSetupPlan {
  return {
    name: "enspack.eth",
    account: ACCOUNT0,
    operator: OPERATOR,
    steps: [],
    already: [
      "resolver already set and writable",
      "registry already set",
      "setParent already matches",
      "operator already has REGISTRAR|RENEW on registry",
      "operator already has SET_TEXT|SET_CONTENTHASH on resolver",
      "subname mirrors.enspack.eth already registered",
      "subname mirrors.enspack.eth already has a UserRegistry",
      "operator already has REGISTRAR|RENEW on mirrors.enspack.eth registry",
    ],
    ops: [],
    slots: {},
    resolver: "0x2222222222222222222222222222222222222222",
    registry: "0x3333333333333333333333333333333333333333",
    subnames: [
      {
        name: "mirrors.enspack.eth",
        label: "mirrors",
        registry: "0x4444444444444444444444444444444444444444",
      },
    ],
  };
}

function fakeHandle(kind: "fresh" | "done" | "not-owner", sent: { count: number }): EnsSetupHandle {
  return {
    account: ACCOUNT0,
    async plan() {
      if (kind === "not-owner") {
        throw new EnspackError(
          "PUBLISH",
          "register enspack.eth first (ENS Sepolia app) with this wallet",
        );
      }
      return kind === "fresh" ? freshPlan() : donePlan();
    },
    async run(): Promise<EnsSetupResult> {
      sent.count += 1;
      throw new Error("runEnsSetup must not be called");
    },
  };
}

describe("ens-setup", () => {
  it("snapshots --help", async () => {
    await withTmp(async (tmp) => {
      const { deps } = await baseDeps(tmp);
      const { code, stdout, stderr } = await runCli(deps, ["ens-setup", "--help"]);
      expect(code).toBe(0);
      expect(stdout).toBe("");
      expect(stderr).toMatchSnapshot();
    });
  });

  it("v1 exits 5 with ens-setup is ENSv2 only", async () => {
    await withTmp(async (tmp) => {
      const { deps } = await baseDeps(tmp);
      deps.env = {
        ...deps.env,
        SEPOLIA_RPC_URL: "http://127.0.0.1:1",
        ENSPACK_ENS_VERSION: "v1",
      };
      const { code, stdout, stderr } = await runCli(deps, [
        "ens-setup",
        "--chain",
        "sepolia",
        "--ens-version",
        "v1",
        "--name",
        "enspack.eth",
        "--dry-run",
      ]);
      expect(code).toBe(5);
      expect(stdout).toBe("");
      expect(stderr).toContain("ens-setup is ENSv2 only");
    });
  });

  it("not owner exits 5 with register first message", async () => {
    await withTmp(async (tmp) => {
      const { deps } = await baseDeps(tmp);
      const sent = { count: 0 };
      deps.env = { ...deps.env, SEPOLIA_RPC_URL: "http://127.0.0.1:1" };
      deps.ensSetupFactory = () => fakeHandle("not-owner", sent);
      const { code, stdout, stderr } = await runCli(deps, [
        "ens-setup",
        "--chain",
        "sepolia",
        "--name",
        "enspack.eth",
        "--dry-run",
      ]);
      expect(code).toBe(5);
      expect(stdout).toBe("");
      expect(stderr).toContain("register enspack.eth first (ENS Sepolia app) with this wallet");
      expect(sent.count).toBe(0);
    });
  });

  it("dry-run --json for a fresh name lists deploy/set/register and sends nothing", async () => {
    await withTmp(async (tmp) => {
      const { deps } = await baseDeps(tmp);
      const sent = { count: 0 };
      deps.env = { ...deps.env, SEPOLIA_RPC_URL: "http://127.0.0.1:1" };
      deps.ensSetupFactory = () => fakeHandle("fresh", sent);
      const { code, stdout, stderr } = await runCli(deps, [
        "ens-setup",
        "--chain",
        "sepolia",
        "--name",
        "enspack.eth",
        "--subname",
        "mirrors",
        "--operator",
        OPERATOR,
        "--dry-run",
        "--json",
      ]);
      expect(code, stderr).toBe(0);
      expect(sent.count).toBe(0);
      expect(stderr).toMatch(/deployProxy/);
      expect(stderr).toMatch(/setResolver/);
      expect(stderr).toMatch(/setSubregistry/);
      expect(stderr).toMatch(/Registry\.register\(mirrors/);
      const payload = JSON.parse(stdout) as {
        name: string;
        txs: unknown[];
        subnames: { name: string }[];
        skipped: unknown[];
      };
      expect(payload.name).toBe("enspack.eth");
      expect(payload.txs).toEqual([]);
      expect(payload.skipped).toEqual([]);
      expect(payload.subnames.map((s) => s.name)).toEqual(["mirrors.enspack.eth"]);
    });
  });

  it("fully set-up name prints skip: lines and 0 txs", async () => {
    await withTmp(async (tmp) => {
      const { deps } = await baseDeps(tmp);
      const sent = { count: 0 };
      deps.env = { ...deps.env, SEPOLIA_RPC_URL: "http://127.0.0.1:1" };
      deps.ensSetupFactory = () => fakeHandle("done", sent);
      const { code, stdout, stderr } = await runCli(deps, [
        "ens-setup",
        "--chain",
        "sepolia",
        "--name",
        "enspack.eth",
        "--subname",
        "mirrors",
        "--operator",
        OPERATOR,
        "--dry-run",
        "--json",
      ]);
      expect(code, stderr).toBe(0);
      expect(sent.count).toBe(0);
      expect(stderr).toMatch(/^skip: resolver already set and writable/m);
      expect(stderr).toMatch(/skip: registry already set/);
      expect(stderr).not.toMatch(/deployProxy/);
      const payload = JSON.parse(stdout) as { txs: unknown[]; skipped: string[] };
      expect(payload.txs).toEqual([]);
      expect(payload.skipped.length).toBeGreaterThan(0);
      expect(payload.skipped.every((s) => s.length > 0)).toBe(true);
    });
  });
});
