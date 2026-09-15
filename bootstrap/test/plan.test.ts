import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PublishInput } from "@enspack/core";
import { EnspackError, namehashOf } from "@enspack/core";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import type { BootstrapDeps } from "../src/deps.js";
import { type PlanJson, planBootstrap } from "../src/plan.js";
import {
  ZERO_ADDR,
  emptyHb,
  fakeHf,
  loadModels,
  modelsYamlPath,
  recordingPublisher,
  resolverThatThrows,
  silentLog,
  tinyModelFiles,
} from "./helpers.js";

describe("plan --json (MVP.md WP-12 dry run)", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  it("includes sizes and gasEstimate per entry and totals", async () => {
    const dir = await mkdtemp(join(tmpdir(), "enspack-plan-"));
    dirs.push(dir);
    const publishes: PublishInput[] = [];
    const chunks: string[] = [];
    const deps: BootstrapDeps = {
      hf: fakeHf(),
      hb: emptyHb(),
      store: {
        async put() {
          throw new Error("plan must not pin");
        },
        async getVerified() {
          throw new Error("unused");
        },
      },
      publisher: recordingPublisher(publishes),
      downloader: {
        async fetch() {
          throw new Error("plan must not download");
        },
      },
      verifier: {
        async verify() {
          throw new Error("verify");
        },
        async quarantine() {
          throw new Error("quarantine");
        },
      },
      seedNode: {
        async seed() {
          throw new Error("seed");
        },
        async status() {
          throw new Error("status");
        },
      },
      resolver: resolverThatThrows(),
      now: () => "2026-09-14T00:00:00.000Z",
      hfWebseed: (repo, revision) => `https://huggingface.co/${repo}/resolve/${revision}/`,
      log: silentLog(),
    };

    const code = await runCli(["plan", "--json", "--tier", "1"], {
      deps,
      modelsPath: modelsYamlPath,
      statePath: join(dir, "state.json"),
      io: {
        stdout: { write: (s) => chunks.push(s) },
        stderr: { write() {} },
      },
    });
    expect(code).toBe(0);
    const plan = JSON.parse(chunks.join("")) as PlanJson;
    expect(plan.entries).toHaveLength(1);
    const row = plan.entries[0];
    expect(row?.status).toBe("ok");
    expect(row?.snapshotSize).toBeGreaterThan(0);
    expect(row?.fileCount).toBe(3);
    expect(row?.license).toBe("apache-2.0");
    expect(row?.hbCrossCheck).toBe("no-artifact");
    expect(row?.gasEstimate).toBe("300000");
    expect(plan.totals.bytes).toBe(row?.snapshotSize);
    expect(plan.totals.gasEstimate).toBe("300000");
    expect(publishes.every((p) => p.dryRun === true)).toBe(true);
    expect(loadModels().models[0]?.repo).toBeDefined();
  });

  it("totals include setup gas from a fake v2 publisher", async () => {
    const dir = await mkdtemp(join(tmpdir(), "enspack-plan-setup-"));
    dirs.push(dir);
    const chunks: string[] = [];
    const deps: BootstrapDeps = {
      hf: fakeHf(),
      hb: emptyHb(),
      store: {
        async put() {
          throw new Error("plan must not pin");
        },
        async getVerified() {
          throw new Error("unused");
        },
      },
      publisher: {
        async publish(input) {
          const register = {
            to: ZERO_ADDR,
            data: "0x" as const,
            description: "register",
            gas: 100_000n,
          };
          const setup = {
            to: ZERO_ADDR,
            data: "0x" as const,
            description: "setup: VerifiableFactory.deployProxy(UserRegistryImpl)",
            gas: 50_000n,
          };
          return {
            name: input.manifest.name,
            model: input.manifest.model,
            cid: input.manifestCid,
            txs: [],
            calls: [register],
            created: { model: true, version: true },
            setup: [setup],
          };
        },
      },
      downloader: {
        async fetch() {
          throw new Error("plan must not download");
        },
      },
      verifier: {
        async verify() {
          throw new Error("verify");
        },
        async quarantine() {
          throw new Error("quarantine");
        },
      },
      seedNode: {
        async seed() {
          throw new Error("seed");
        },
        async status() {
          throw new Error("status");
        },
      },
      resolver: resolverThatThrows(),
      now: () => "2026-09-14T00:00:00.000Z",
      hfWebseed: (repo, revision) => `https://huggingface.co/${repo}/resolve/${revision}/`,
      log: silentLog(),
    };

    const code = await runCli(["plan", "--json", "--tier", "1"], {
      deps,
      modelsPath: modelsYamlPath,
      statePath: join(dir, "state.json"),
      io: {
        stdout: { write: (s) => chunks.push(s) },
        stderr: { write() {} },
      },
    });
    expect(code).toBe(0);
    const plan = JSON.parse(chunks.join("")) as PlanJson;
    expect(plan.entries[0]?.gasEstimate).toBe("150000");
    expect(plan.totals.gasEstimate).toBe("150000");
    expect(plan.entries[0]?.plan).toMatch(
      /setup: VerifiableFactory\.deployProxy\(UserRegistryImpl\)/,
    );
  });
});

describe("planBootstrap resilience (WP-22)", () => {
  function basePlanDeps(overrides: Partial<BootstrapDeps> = {}): BootstrapDeps {
    return {
      hf: fakeHf(),
      hb: emptyHb(),
      store: {
        async put() {
          throw new Error("plan must not pin");
        },
        async getVerified() {
          throw new Error("unused");
        },
      },
      publisher: recordingPublisher([]),
      downloader: {
        async fetch() {
          throw new Error("plan must not download");
        },
      },
      verifier: {
        async verify() {
          throw new Error("verify");
        },
        async quarantine() {
          throw new Error("quarantine");
        },
      },
      seedNode: {
        async seed() {
          throw new Error("seed");
        },
        async status() {
          throw new Error("status");
        },
      },
      resolver: resolverThatThrows(),
      now: () => "2026-09-14T00:00:00.000Z",
      hfWebseed: (repo, revision) => `https://huggingface.co/${repo}/resolve/${revision}/`,
      log: silentLog(),
      ...overrides,
    };
  }

  it("records a throwing publisher as failed and continues other entries", async () => {
    const config = loadModels();
    const first = config.models[0];
    if (first === undefined) throw new Error("fixture");
    const second = { ...first, repo: "enspack/other-model" };
    const inner = recordingPublisher([]);
    const deps = basePlanDeps({
      publisher: {
        async publish(input) {
          if (input.manifest.model.includes("tiny-model")) {
            throw new EnspackError("PUBLISH", "version name already points at cid");
          }
          return inner.publish(input);
        },
      },
    });
    const plan = await planBootstrap(config, [first, second], "sepolia", deps);
    expect(plan.entries).toHaveLength(2);
    expect(plan.entries[0]?.status).toBe("failed");
    expect(plan.entries[0]?.reason).toMatch(/already points/);
    expect(plan.entries[1]?.status).toBe("ok");
    expect(plan.entries[1]?.version).toBe("1.0.0");
    expect(plan.totals.bytes).toBe(plan.entries[1]?.snapshotSize);
    expect(plan.totals.gasEstimate).toBe(plan.entries[1]?.gasEstimate);
  });

  it("plans 1.1.0 when the model name already resolves", async () => {
    const config = loadModels();
    const entry = config.models[0];
    if (entry === undefined) throw new Error("fixture");
    const prevCid = `bafkrei${"c".repeat(52)}`;
    const deps = basePlanDeps({
      resolver: {
        async resolve(ref) {
          if (!ref.includes("enspack--tiny-model")) {
            throw new EnspackError("RESOLVE", `unresolved ${ref}`);
          }
          return {
            name: ref,
            node: namehashOf(ref),
            cid: prevCid,
            magnet: null,
            spec: "enspack/0.1" as const,
            manifest: {
              spec: "enspack/0.1" as const,
              name: "v1-0-0.enspack--tiny-model.mirrors.enspack.eth",
              model: "enspack--tiny-model.mirrors.enspack.eth",
              publisher: "mirrors.enspack.eth",
              version: "1.0.0",
              createdAt: "2026-09-14T00:00:00Z",
              license: "apache-2.0",
              distribution: {
                infohash: "0".repeat(40),
                magnet: `magnet:?xt=urn:btih:${"0".repeat(40)}`,
                webseeds: ["https://example.invalid/"],
              },
              files: tinyModelFiles(),
              totalSize: tinyModelFiles().reduce((s, f) => s + f.size, 0),
              versions: [
                {
                  version: "1.0.0",
                  name: "v1-0-0.enspack--tiny-model.mirrors.enspack.eth",
                  cid: `bafkrei${"a".repeat(52)}`,
                  createdAt: "2026-09-14T00:00:00Z",
                },
              ],
            },
            manifestBytes: null,
          };
        },
      },
    });
    const plan = await planBootstrap(config, [entry], "sepolia", deps);
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]?.status).toBe("ok");
    expect(plan.entries[0]?.version).toBe("1.1.0");
    expect(plan.entries[0]?.name).toMatch(/^v1-1-0\./);
  });
});
