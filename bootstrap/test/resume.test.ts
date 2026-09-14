import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Aria2Downloader, Sha256Verifier } from "@enspack/torrent";
import { manifestCid, type PublishInput } from "@enspack/core";
import { afterEach, describe, expect, it } from "vitest";
import { runBootstrap } from "../src/run.js";
import {
  TINY_REPO,
  confirmingResolver,
  emptyHb,
  fakeHf,
  fixtureDir,
  loadModels,
  recordingPublisher,
  seedClientFrom,
  silentLog,
  startFakeSeed,
  startWebseed,
} from "./helpers.js";
import type { BootstrapDeps } from "../src/deps.js";

describe("resume (BOOTSTRAP.md §5)", () => {
  const dirs: string[] = [];
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((c) => c()));
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  it("crashes after torrent (store throws once), --resume finishes, done re-run is a no-op", async () => {
    const dir = await mkdtemp(join(tmpdir(), "enspack-resume-"));
    dirs.push(dir);
    const web = await startWebseed(fixtureDir);
    closers.push(web.close);
    const seed = await startFakeSeed();
    closers.push(seed.close);

    const publishes: PublishInput[] = [];
    let puts = 0;
    let lastCid: string | null = null;

    const deps: BootstrapDeps = {
      hf: fakeHf(),
      hb: emptyHb(),
      store: {
        async put(bytes: Uint8Array) {
          puts += 1;
          if (puts === 1) throw new Error("crash after step 5");
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
    const runOpts = {
      config,
      entries: config.models,
      statePath: join(dir, "state.json"),
      downloads: join(dir, "dl"),
      chain: "sepolia" as const,
      submitHb: false,
      seedTimeoutMs: 5_000,
      seedPollMs: 10,
    };

    await expect(runBootstrap({ ...runOpts, resume: false }, deps)).rejects.toThrow(
      /crash after step 5/,
    );

    const crashed = JSON.parse(await readFile(join(dir, "state.json"), "utf8")) as {
      entries: Record<string, { status: string; step?: string; completedSteps: string[] }>;
    };
    const rec = crashed.entries[TINY_REPO];
    expect(rec?.status).toBe("in-progress");
    expect(rec?.step).toBe("pin");
    expect(rec?.completedSteps).toEqual(["gate", "files", "download", "verify", "torrent"]);

    const afterResume = await runBootstrap({ ...runOpts, resume: true }, deps);
    expect(afterResume[0]?.status).toBe("done");
    expect(publishes.filter((p) => p.dryRun !== true)).toHaveLength(1);

    const afterDone = await runBootstrap({ ...runOpts, resume: true }, deps);
    expect(afterDone[0]?.status).toBe("done");
    expect(publishes.filter((p) => p.dryRun !== true)).toHaveLength(1);
  });
});
