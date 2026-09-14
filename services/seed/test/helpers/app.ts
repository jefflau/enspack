import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnspackError, type IpfsManifestStore, type Resolver, kuboPinner } from "@enspack/core";
import { type SeedAppDeps, createApp } from "../../src/app.js";
import { createKuboClient } from "../../src/kubo.js";
import { createQbittorrentClient } from "../../src/qbittorrent.js";
import type { TinyFixture } from "./fixtures.js";
import { type FakeKubo, startFakeKubo } from "./kubo-fake.js";
import { type FakeQbt, startFakeQbt } from "./qbt-fake.js";

export function silentLog(): void {}

export function fixtureResolver(fx: TinyFixture): Resolver {
  return {
    async resolve() {
      return fx.resolved;
    },
  };
}

export function throwingResolver(err: EnspackError): Resolver {
  return {
    async resolve() {
      throw err;
    },
  };
}

export function fixtureStore(fx: TinyFixture): IpfsManifestStore {
  return {
    async getVerified(cid) {
      if (cid === fx.torrentCid) return fx.torrentBytes;
      if (cid === fx.cid) return fx.manifestBytes;
      throw new EnspackError("FETCH", `unknown cid ${cid}`);
    },
    async put() {
      throw new EnspackError("PUBLISH", "put unused in tests");
    },
  };
}

export interface TestContext {
  app: ReturnType<typeof createApp>;
  qbt: FakeQbt;
  kubo: FakeKubo;
  downloadDir: string;
  fx: TinyFixture;
}

export async function makeTestApp(
  fx: TinyFixture,
  overrides: Partial<SeedAppDeps> = {},
): Promise<TestContext> {
  const qbt = await startFakeQbt();
  const kubo = await startFakeKubo();
  const downloadDir = await mkdtemp(join(tmpdir(), "enspack-seed-"));
  const app = createApp({
    resolver: fixtureResolver(fx),
    store: fixtureStore(fx),
    qbt: createQbittorrentClient({
      baseUrl: qbt.origin,
      username: "admin",
      password: "adminadmin",
    }),
    kubo: createKuboClient({ apiUrl: kubo.origin }),
    pinner: kuboPinner({ apiUrl: kubo.origin }),
    allowRoots: ["enspack.eth"],
    quotaBytesPerPublisher: 2 * 1024 * 1024 * 1024 * 1024,
    downloadDir,
    chain: "sepolia",
    log: silentLog,
    ...overrides,
  });
  return { app, qbt, kubo, downloadDir, fx };
}
