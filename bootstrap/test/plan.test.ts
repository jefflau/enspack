import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PublishInput } from "@enspack/core";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import type { BootstrapDeps } from "../src/deps.js";
import type { PlanJson } from "../src/plan.js";
import {
  emptyHb,
  fakeHf,
  loadModels,
  modelsYamlPath,
  recordingPublisher,
  resolverThatThrows,
  silentLog,
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
});
