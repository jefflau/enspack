import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BootstrapDeps } from "../src/deps.js";
import { runBootstrap } from "../src/run.js";
import {
  TINY_REPO,
  emptyHb,
  fakeHf,
  loadModels,
  resolverThatThrows,
  silentLog,
} from "./helpers.js";

const calls: string[] = [];

function unused(name: string): never {
  calls.push(name);
  throw new Error(`should not call ${name}`);
}

function gateDeps(hf: ReturnType<typeof fakeHf>): BootstrapDeps {
  return {
    hf,
    hb: emptyHb(),
    store: {
      put: () => unused("store.put"),
      getVerified: () => unused("store.getVerified"),
    },
    publisher: { publish: () => unused("publish") },
    downloader: { fetch: () => unused("download") },
    verifier: {
      verify: () => unused("verify"),
      quarantine: () => unused("quarantine"),
    },
    seedNode: { seed: () => unused("seed"), status: () => unused("status") },
    resolver: resolverThatThrows(),
    now: () => "2026-09-14T00:00:00Z",
    hfWebseed: () => unused("hfWebseed"),
    log: silentLog(),
  };
}

describe("gate (BOOTSTRAP.md §2 / §5 step 1)", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    calls.length = 0;
  });

  async function run(hf: ReturnType<typeof fakeHf>) {
    const dir = await mkdtemp(join(tmpdir(), "enspack-gate-"));
    dirs.push(dir);
    const config = loadModels();
    return runBootstrap(
      {
        config,
        entries: config.models,
        statePath: join(dir, "state.json"),
        downloads: join(dir, "dl"),
        chain: "sepolia",
        resume: false,
        submitHb: false,
      },
      gateDeps(hf),
    );
  }

  it("skips a gated repo with a reason", async () => {
    const records = await run(fakeHf({ gated: true }));
    expect(records[0]?.status).toBe("skipped");
    expect(records[0]?.reason).toMatch(/gated/);
    expect(calls).toEqual([]);
  });

  it("skips a license that is not allowlisted", async () => {
    const records = await run(fakeHf({ license: "llama3.1" }));
    expect(records[0]?.status).toBe("skipped");
    expect(records[0]?.reason).toMatch(/allowlist/);
  });

  it("skips when license !== expected_license", async () => {
    const records = await run(fakeHf({ license: "mit" }));
    expect(records[0]?.status).toBe("skipped");
    expect(records[0]?.reason).toMatch(/expected_license/);
  });

  it("fails when the short yaml revision is not a prefix of the resolved sha", async () => {
    const records = await run(fakeHf({ sha: "ffffffffffffffffffffffffffffffffffffffff" }));
    expect(records[0]?.status).toBe("failed");
    expect(records[0]?.reason).toMatch(/does not start with yaml revision/);
    expect(records[0]?.repo).toBe(TINY_REPO);
  });
});
