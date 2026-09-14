import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Aria2Downloader, Sha256Verifier } from "@enspack/torrent";
import { validateManifest } from "@enspack/core";
import { afterEach, describe, expect, it } from "vitest";
import { runBootstrap } from "../src/run.js";
import { versionNameFor } from "../src/names.js";
import {
  TINY_REPO,
  TINY_SHA,
  confirmingResolver,
  emptyHb,
  fakeHf,
  fixtureDir,
  loadFixtureManifest,
  loadModels,
  recordingPublisher,
  seedClientFrom,
  silentLog,
  startFakeSeed,
  startWebseed,
  tinyModelFiles,
} from "./helpers.js";
import type { BootstrapDeps } from "../src/deps.js";
import type { PublishInput } from "@enspack/core";
import { manifestCid } from "@enspack/core";

describe("full pipeline (tiny-model fixture)", () => {
  const dirs: string[] = [];
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((c) => c()));
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  it("validates the published mirror, reaches done, publishes once on sepolia", async () => {
    const dir = await mkdtemp(join(tmpdir(), "enspack-pipe-"));
    dirs.push(dir);
    const web = await startWebseed(fixtureDir);
    closers.push(web.close);
    const seed = await startFakeSeed();
    closers.push(seed.close);

    const publishes: PublishInput[] = [];
    let lastCid: string | null = null;
    const deps: BootstrapDeps = {
      hf: fakeHf(),
      hb: emptyHb(),
      store: {
        async put(bytes: Uint8Array) {
          const cid = await manifestCid(bytes);
          lastCid = cid;
          return cid;
        },
        async getVerified() {
          throw new Error("unused");
        },
      },
      publisher: recordingPublisher(publishes),
      downloader: new Aria2Downloader({ dht: false }),
      verifier: new Sha256Verifier(),
      seedNode: seedClientFrom(seed),
      resolver: confirmingResolver(() => lastCid),
      now: () => "2026-09-14T00:00:00.000Z",
      hfWebseed: (repo, revision) => `https://huggingface.co/${repo}/resolve/${revision}/`,
      downloadWebseeds: () => [web.url],
      log: silentLog(),
    };

    const config = loadModels();
    const records = await runBootstrap(
      {
        config,
        entries: config.models,
        statePath: join(dir, "state.json"),
        downloads: join(dir, "dl"),
        chain: "sepolia",
        resume: false,
        submitHb: false,
        seedTimeoutMs: 5_000,
        seedPollMs: 10,
      },
      deps,
    );

    expect(records[0]?.status).toBe("done");
    const live = publishes.filter((p) => p.dryRun !== true);
    expect(live).toHaveLength(1);
    expect(live[0]?.chain).toBe("sepolia");
    const manifest = live[0]?.manifest;
    expect(manifest).toBeDefined();
    if (manifest === undefined) throw new Error("missing manifest");
    validateManifest(manifest);
    expect(manifest.name).toBe(versionNameFor("1.0.0", "enspack", "tiny-model"));
    expect(manifest.name).toBe("v1-0-0.enspack--tiny-model.mirrors.enspack.eth");
    expect(manifest.canonical).toBe("tiny-model.enspack.enspack.eth");
    expect(manifest.files).toEqual(tinyModelFiles());
    expect(manifest.files).toEqual(loadFixtureManifest().files);
    expect(manifest.upstream?.revision).toBe(TINY_SHA);
    expect(seed.names).toContain(manifest.name);

    const stateRaw = JSON.parse(await readFile(join(dir, "state.json"), "utf8")) as {
      entries: Record<string, { status: string }>;
    };
    expect(stateRaw.entries[TINY_REPO]?.status).toBe("done");
  });
});
