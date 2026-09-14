import { open, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Aria2Downloader, Sha256Verifier } from "@enspack/torrent";
import { afterEach, describe, expect, it } from "vitest";
import { runBootstrap } from "../src/run.js";
import {
  confirmingResolver,
  emptyHb,
  fakeHf,
  fixtureDir,
  loadModels,
  recordingPublisher,
  silentLog,
  startWebseed,
} from "./helpers.js";
import type { BootstrapDeps } from "../src/deps.js";
import { downloadDirName } from "../src/names.js";

describe("local tamper (BOOTSTRAP.md §5 step 4)", () => {
  const dirs: string[] = [];
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(closers.splice(0).map((c) => c()));
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  it("fails with the path in the reason and quarantines the directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "enspack-tamper-"));
    dirs.push(dir);
    const web = await startWebseed(fixtureDir);
    closers.push(web.close);
    const real = new Aria2Downloader({ dht: false });

    const deps: BootstrapDeps = {
      hf: fakeHf(),
      hb: emptyHb(),
      store: {
        async put() {
          throw new Error("must not pin after tamper");
        },
        async getVerified() {
          throw new Error("unused");
        },
      },
      publisher: recordingPublisher([]),
      downloader: {
        async fetch(m, dest, opts) {
          await real.fetch(m, dest, opts);
          const target = join(dest, "config.json");
          const fh = await open(target, "r+");
          try {
            const buf = Buffer.alloc(1);
            await fh.read(buf, 0, 1, 0);
            buf[0] = (buf[0] ?? 0) ^ 0xff;
            await fh.write(buf, 0, 1, 0);
          } finally {
            await fh.close();
          }
        },
      },
      verifier: new Sha256Verifier(),
      seedNode: {
        async seed() {
          throw new Error("seed");
        },
        async status() {
          throw new Error("status");
        },
      },
      resolver: confirmingResolver(() => null),
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
      },
      deps,
    );
    expect(records[0]?.status).toBe("failed");
    expect(records[0]?.reason).toMatch(/config\.json/);
    expect(records[0]?.reason).toMatch(/quarantine/i);
    const dest = join(dir, "dl", downloadDirName("enspack", "tiny-model"));
    expect(records[0]?.reason).toContain(join(dest, ".enspack-quarantine"));
  });
});
