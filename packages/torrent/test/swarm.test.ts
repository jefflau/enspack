import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateManifest } from "@enspack/core";
import { afterEach, describe, expect, it } from "vitest";
import { Aria2Downloader, Sha256Verifier, createTorrent } from "../src/index.js";
import { aria2cAvailable, killChild, spawnSeeder } from "./helpers/aria2.js";
import { fixtureDir, fixtureFiles, manifestPath } from "./helpers/paths.js";
import { freePort } from "./helpers/ports.js";
import { startTracker } from "./helpers/tracker.js";
import { startWebseed } from "./helpers/webseed.js";

const dirs: string[] = [];
const closers: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    await close?.();
  }
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function stagingContent(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "enspack-content-"));
  dirs.push(dir);
  for (const name of fixtureFiles) {
    await cp(join(fixtureDir, name), join(dir, name));
  }
  return dir;
}

describe.skipIf(!aria2cAvailable())("local swarm", () => {
  it("two-process swarm via a local BEP 3 tracker completes and verifies", async () => {
    const content = await stagingContent();
    const seedPort = await freePort();
    const tracker = await startTracker("127.0.0.1", seedPort);
    closers.push(() => tracker.close());

    const created = await createTorrent(content, {
      name: "tiny-model",
      webseeds: [],
      announce: [tracker.url],
    });

    const seedRoot = await mkdtemp(join(tmpdir(), "enspack-seed-"));
    dirs.push(seedRoot);
    await mkdir(join(seedRoot, "tiny-model"), { recursive: true });
    for (const name of fixtureFiles) {
      await cp(join(content, name), join(seedRoot, "tiny-model", name));
    }
    const torrentFile = join(seedRoot, "swarm.torrent");
    await writeFile(torrentFile, created.metainfo);

    const seeder = spawnSeeder([
      `--dir=${seedRoot}`,
      "--seed-time=60",
      `--listen-port=${seedPort}`,
      "--enable-dht=false",
      "--enable-peer-exchange=false",
      "--bt-enable-lpd=false",
      "--bt-external-ip=127.0.0.1",
      "--check-integrity=true",
      "--bt-seed-unverified=true",
      "--file-allocation=none",
      "--summary-interval=1",
      "--console-log-level=notice",
      "--allow-overwrite=true",
      "--",
      torrentFile,
    ]);
    closers.push(() => killChild(seeder));
    await new Promise((r) => setTimeout(r, 1500));

    const dest = await mkdtemp(join(tmpdir(), "enspack-dl-"));
    dirs.push(dest);
    const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
    const dl = new Aria2Downloader({
      btStopTimeout: 30,
      dht: false,
      extraArgs: [
        "--bt-external-ip=127.0.0.1",
        "--enable-dht=false",
        "--enable-peer-exchange=false",
      ],
    });
    await dl.fetch(manifest, dest, { metainfo: created.metainfo });
    const result = await new Sha256Verifier().verify(manifest, dest);
    expect(result).toEqual({ ok: true });
    for (const name of fixtureFiles) {
      expect(existsSync(join(dest, name))).toBe(true);
    }
  });

  it("swarm works at zero peers via webseed and select *.json downloads only json", async () => {
    const content = await stagingContent();
    const web = await startWebseed(content);
    closers.push(() => web.close());

    const created = await createTorrent(content, {
      name: "tiny-model",
      webseeds: [web.url],
    });

    const destAll = await mkdtemp(join(tmpdir(), "enspack-ws-"));
    dirs.push(destAll);
    const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
    const dl = new Aria2Downloader({
      btStopTimeout: 30,
      dht: false,
      extraArgs: ["--enable-dht=false", "--enable-peer-exchange=false", "--bt-enable-lpd=false"],
    });
    await dl.fetch(manifest, destAll, { metainfo: created.metainfo, webseeds: [web.url] });
    expect(await new Sha256Verifier().verify(manifest, destAll)).toEqual({ ok: true });

    const destJson = await mkdtemp(join(tmpdir(), "enspack-wsj-"));
    dirs.push(destJson);
    await dl.fetch(manifest, destJson, {
      httpOnly: true,
      webseeds: [web.url],
      select: ["*.json"],
    });
    expect(existsSync(join(destJson, "config.json"))).toBe(true);
    expect(existsSync(join(destJson, "tokenizer.json"))).toBe(true);
    expect(existsSync(join(destJson, "model.safetensors"))).toBe(false);
    expect(await new Sha256Verifier().verify(manifest, destJson, ["*.json"])).toEqual({ ok: true });
  });
});
