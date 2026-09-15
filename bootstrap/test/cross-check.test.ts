import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BootstrapDeps } from "../src/deps.js";
import { runBootstrap } from "../src/run.js";
import { stepFiles } from "../src/steps/files.js";
import {
  TINY_REPO,
  TINY_SHA,
  disagreeingHb,
  fakeHf,
  loadModels,
  noLockHb,
  resolverThatThrows,
  silentLog,
} from "./helpers.js";

describe("cross-check (BOOTSTRAP.md §2 rule 3)", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  it("fails the entry on HB disagreement and does not download or publish", async () => {
    const downloadCalls: string[] = [];
    const publishCalls: string[] = [];
    const dir = await mkdtemp(join(tmpdir(), "enspack-xcheck-"));
    dirs.push(dir);
    const config = loadModels();
    const deps: BootstrapDeps = {
      hf: fakeHf(),
      hb: disagreeingHb(),
      store: {
        async put() {
          throw new Error("store.put");
        },
        async getVerified() {
          throw new Error("store.get");
        },
      },
      publisher: {
        async publish() {
          publishCalls.push("publish");
          throw new Error("publish");
        },
      },
      downloader: {
        async fetch() {
          downloadCalls.push("download");
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
      now: () => "2026-09-14T00:00:00Z",
      hfWebseed: () =>
        "https://huggingface.co/enspack/tiny-model/resolve/abcdef1200000000000000000000000000000000/",
      log: silentLog(),
    };
    const records = await runBootstrap(
      {
        config,
        entries: config.models,
        statePath: join(dir, "state.json"),
        downloads: join(dir, "dl"),
        chain: "sepolia",
        resume: false,
        submitHb: false,
      },
      deps,
    );
    expect(records[0]?.status).toBe("failed");
    expect(records[0]?.reason).toMatch(/disagrees|sha256|size/i);
    expect(downloadCalls).toEqual([]);
    expect(publishCalls).toEqual([]);
    expect(records[0]?.completedSteps).toEqual(["gate"]);
  });

  it("treats a missing HB lock as ok and skips the cross-check", async () => {
    const logs: string[] = [];
    const result = await stepFiles(
      { repo: TINY_REPO, tier: 1, expected_license: "apache-2.0", revision: "abcdef12" },
      TINY_SHA,
      {
        hf: fakeHf(),
        hb: noLockHb(),
        log: {
          info(message) {
            logs.push(message);
          },
          warn() {},
        },
      },
    );
    expect(result.outcome).toBe("ok");
    expect(result.data.hbCrossCheck).toBe("skipped");
    expect(logs).toContain("no Hugging Bay lock; cross-check skipped");
  });
});
