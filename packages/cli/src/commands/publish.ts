import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_GATEWAYS,
  EnspackError,
  MIRROR_NAMESPACE,
  type Manifest,
  type ManifestStore,
  type Pinner,
  type PublishResult,
  canonicalJson,
  createManifestStore,
  ensVersionFor,
  formatPublishPlan,
  isEnspackError,
  kuboPinner,
  manifestCid,
  mirrorLabel,
  normalizeLabel,
  pinataPinner,
  seedNodePinner,
  validateManifest,
  versionLabel,
} from "@enspack/core";
import { crossCheck, hfWebseed } from "@enspack/hf";
import { createTorrent, magnetFor } from "@enspack/torrent";
import type { Command } from "commander";
import { expectedPublishTxs, formatExpectedTxs, setupCalls } from "../ens.js";
import { human, writeJson } from "../io.js";
import { addGlobalOpts, collect, createProgressWriter, parseChain, rpcUrlFor } from "../opts.js";
import type { CliDeps } from "../types.js";

export interface PublishFlags {
  fromHf: string;
  publisher: string;
  version: string;
  revision?: string;
  webseed?: string[];
  pin?: "kubo" | "pinata" | "seed";
  seedNode?: string;
  submitHb?: boolean;
  dryRun?: boolean;
  iHaveRedistributionRights?: boolean;
  json?: boolean;
  chain?: string;
}

function isMirrorPublisher(publisher: string): boolean {
  return publisher === MIRROR_NAMESPACE || publisher.endsWith(`.${MIRROR_NAMESPACE}`);
}

function splitRepo(repo: string): { org: string; name: string } {
  const slash = repo.indexOf("/");
  if (slash <= 0 || slash === repo.length - 1) {
    throw new EnspackError("PUBLISH", `expected org/repo, got ${JSON.stringify(repo)}`);
  }
  return { org: repo.slice(0, slash), name: repo.slice(slash + 1) };
}

function parseGateways(env: NodeJS.ProcessEnv): string[] {
  const extra = env.ENSPACK_IPFS_GATEWAYS;
  const extras =
    extra !== undefined && extra !== ""
      ? extra
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : [];
  return [...extras, ...DEFAULT_GATEWAYS];
}

function pinnerFor(
  kind: "kubo" | "pinata" | "seed",
  deps: CliDeps,
  seedNode: string | undefined,
): Pinner {
  if (kind === "kubo") {
    const apiUrl = deps.env.ENSPACK_KUBO_API;
    if (apiUrl === undefined || apiUrl === "") {
      throw new EnspackError("PUBLISH", "ENSPACK_KUBO_API is not set");
    }
    return kuboPinner({ apiUrl });
  }
  if (kind === "pinata") {
    const jwt = deps.env.PINATA_JWT;
    if (jwt === undefined || jwt === "") {
      throw new EnspackError("PUBLISH", "PINATA_JWT is not set");
    }
    return pinataPinner({ jwt });
  }
  const baseUrl = seedNode ?? deps.env.ENSPACK_SEED_NODE;
  if (baseUrl === undefined || baseUrl === "") {
    throw new EnspackError(
      "PUBLISH",
      "seed node URL is not set (pass --seed-node or ENSPACK_SEED_NODE)",
    );
  }
  return seedNodePinner({ baseUrl });
}

function pinStore(deps: CliDeps, pinner: Pinner): ManifestStore {
  if (deps.storeWithPinner !== undefined) {
    return deps.storeWithPinner(pinner);
  }
  return createManifestStore({ gateways: parseGateways(deps.env), pinner });
}

async function putBytes(
  deps: CliDeps,
  flags: PublishFlags,
  bytes: Uint8Array,
  contentType: "application/json" | "application/x-bittorrent",
): Promise<string> {
  if (flags.dryRun === true) {
    return manifestCid(bytes);
  }
  if (flags.pin === undefined) {
    throw new EnspackError("PUBLISH", "no pinner configured; pass --pin kubo|pinata|seed");
  }
  type PinStore = ManifestStore & {
    put(
      bytes: Uint8Array,
      contentType?: "application/json" | "application/x-bittorrent",
    ): Promise<string>;
  };
  if (deps.storeWithPinner === undefined) {
    return (deps.store as PinStore).put(bytes, contentType);
  }
  const store = pinStore(deps, pinnerFor(flags.pin, deps, flags.seedNode)) as PinStore;
  return store.put(bytes, contentType);
}

async function previousVersions(
  deps: CliDeps,
  chain: "mainnet" | "sepolia",
  modelName: string,
): Promise<{ versions: Manifest["versions"]; previous?: string }> {
  try {
    const resolved = await deps
      .resolverFactory(chain, rpcUrlFor(chain, deps.env))
      .resolve(modelName, { chain });
    if (resolved.manifest !== null && resolved.cid !== null) {
      const out: { versions: Manifest["versions"]; previous?: string } = {
        versions: resolved.manifest.versions,
      };
      out.previous = resolved.cid;
      return out;
    }
  } catch (err) {
    if (isEnspackError(err) && (err.code === "RESOLVE" || err.code === "FETCH")) {
      return { versions: [] as unknown as Manifest["versions"] };
    }
    throw err;
  }
  return { versions: [] as unknown as Manifest["versions"] };
}

/**
 * SPEC §8: publish from Hugging Face (`--from-hf`) through torrent, pin, and on-chain records.
 */
export async function runPublish(deps: CliDeps, flags: PublishFlags): Promise<void> {
  const chain = parseChain(flags.chain ?? "mainnet");
  const override = flags.iHaveRedistributionRights === true;
  const repo = flags.fromHf;
  const { org, name: repoName } = splitRepo(repo);
  const info = await deps.hf.info(repo);
  deps.hf.licenseGate(info.license, { override });
  if ((info.gated !== false || info.private === true) && !override) {
    throw new EnspackError(
      "POLICY",
      `repo ${repo} is gated or private; pass --i-have-redistribution-rights to override`,
    );
  }

  const revision =
    flags.revision !== undefined && flags.revision !== ""
      ? flags.revision
      : await deps.hf.resolveRevision(repo, "main");
  const files = await deps.hf.buildFiles(repo, revision);
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  human(deps.stderr, `${repo}@${revision}: ${files.length} files, ${totalSize} bytes`);

  const artifact = await deps.hf.huggingBay.resolve(repo);
  if (artifact === null) {
    human(deps.stderr, "Hugging Bay artifact not found; skipping cross-check");
  } else {
    const hbLock = await deps.hf.huggingBay.lock(artifact.id);
    crossCheck(files, hbLock);
  }

  const webseeds = [hfWebseed(repo, revision), ...(flags.webseed ?? [])];
  const staging = join(tmpdir(), `enspack-publish-${process.pid}-${Date.now()}`);
  await mkdir(staging, { recursive: true });

  const dummyInfohash = "0".repeat(40);
  const draft = {
    spec: "enspack/0.1" as const,
    name: "v0-0-0.draft.enspack.eth",
    model: "draft.enspack.eth",
    publisher: "enspack.eth",
    version: "0.0.0",
    createdAt: "1970-01-01T00:00:00Z",
    license: info.license ?? "unknown",
    distribution: {
      infohash: dummyInfohash,
      magnet: magnetFor(dummyInfohash),
      webseeds,
    },
    files,
    totalSize,
    versions: [
      {
        version: "0.0.0",
        name: "v0-0-0.draft.enspack.eth",
        cid: `bafkrei${"d".repeat(52)}`,
        createdAt: "1970-01-01T00:00:00Z",
      },
    ],
  } as unknown as Manifest;

  try {
    await deps.downloader.fetch(draft, staging, {
      httpOnly: true,
      onProgress: createProgressWriter(deps.stderr),
    });
    const verified = await deps.verifier.verify(draft, staging);
    if (!verified.ok) {
      throw new EnspackError(
        "VERIFY",
        `publish snapshot does not match files[] (${verified.failures.map((f) => f.path).join(", ")})`,
      );
    }

    const mirror = isMirrorPublisher(flags.publisher);
    const modelLabel = mirror ? mirrorLabel(org, repoName) : normalizeLabel(repoName);
    const torrent = await createTorrent(staging, { name: modelLabel, webseeds });
    const torrentCid = await putBytes(deps, flags, torrent.metainfo, "application/x-bittorrent");

    const modelName = `${modelLabel}.${flags.publisher}`;
    const versionName = `${versionLabel(flags.version)}.${modelName}`;
    const createdAt = (deps.now ?? (() => new Date()))().toISOString();
    const prev = await previousVersions(deps, chain, modelName);

    const placeholderCid = `bafkrei${"p".repeat(52)}`;
    const thisVersion = {
      version: flags.version,
      name: versionName,
      cid: placeholderCid,
      createdAt,
    };
    const versions = [...prev.versions, thisVersion] as Manifest["versions"];

    const manifestDraft: Record<string, unknown> = {
      spec: "enspack/0.1",
      name: versionName,
      model: modelName,
      publisher: flags.publisher,
      version: flags.version,
      createdAt,
      displayName: repoName,
      license: (info.license ?? "unknown").toLowerCase(),
      licenseUrl: `https://huggingface.co/${repo}/blob/${revision}/LICENSE`,
      upstream: {
        provider: "huggingface",
        repo,
        url: `https://huggingface.co/${repo}`,
        revision,
      },
      distribution: {
        infohash: torrent.infohash,
        magnet: magnetFor(torrent.infohash, modelLabel),
        torrent: { cid: torrentCid },
        webseeds,
      },
      files,
      totalSize,
      versions,
    };
    if (prev.previous !== undefined) {
      manifestDraft.previous = prev.previous;
    }
    if (mirror) {
      manifestDraft.canonical = `${normalizeLabel(repoName)}.${normalizeLabel(org)}.enspack.eth`;
    }

    const first = validateManifest(manifestDraft);
    const firstCid = await manifestCid(canonicalJson(first));
    const last = first.versions[first.versions.length - 1];
    if (last !== undefined) {
      last.cid = firstCid;
    }
    const manifest = validateManifest(first);
    const manifestBytes = canonicalJson(manifest);
    const C = await putBytes(deps, flags, manifestBytes, "application/json");

    const publisher = deps.publisherFactory(chain, rpcUrlFor(chain, deps.env));
    const published: PublishResult = await publisher.publish({
      manifest,
      manifestCid: C,
      chain,
      dryRun: flags.dryRun === true,
    });
    const ensVersion = ensVersionFor(chain, deps.env);
    const setup = setupCalls(published);
    const expected = expectedPublishTxs(ensVersion, published.created, setup.length);

    if (setup.length > 0) {
      human(deps.stderr, formatPublishPlan(setup));
    }
    human(deps.stderr, formatExpectedTxs(expected));
    if (flags.dryRun === true) {
      human(deps.stderr, new TextDecoder().decode(manifestBytes));
      human(deps.stderr, `cid ${C}`);
      human(deps.stderr, formatPublishPlan(published.calls));
    }

    const seedUrl = flags.seedNode ?? deps.env.ENSPACK_SEED_NODE;
    if (seedUrl !== undefined && seedUrl !== "" && flags.dryRun !== true) {
      const fetchImpl = deps.fetch ?? globalThis.fetch;
      try {
        const res = await fetchImpl(`${seedUrl.replace(/\/+$/, "")}/v1/seed`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ name: versionName }),
        });
        if (!res.ok) {
          human(deps.stderr, `seed-node POST /v1/seed failed HTTP ${res.status}`);
        }
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        human(deps.stderr, `seed-node POST /v1/seed failed: ${msg}`);
      }
    }

    if (flags.submitHb === true && artifact !== null && flags.dryRun !== true) {
      try {
        await deps.hf.huggingBay.submitFallback(artifact.id, {
          magnet: manifest.distribution.magnet,
          displayName: modelLabel,
          infohash: torrent.infohash,
        });
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        human(deps.stderr, `Hugging Bay submitFallback failed: ${msg}`);
      }
    }

    if (flags.json === true) {
      writeJson(deps.stdout, {
        name: published.name,
        model: published.model,
        cid: published.cid,
        infohash: torrent.infohash,
        txs: published.txs,
        calls: published.calls,
        ensVersion,
        setup,
      });
      return;
    }
    human(
      deps.stderr,
      `published ${published.name} cid=${published.cid} infohash=${torrent.infohash}`,
    );
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function registerPublish(program: Command, deps: CliDeps): void {
  addGlobalOpts(
    program
      .command("publish")
      .description("Publish from Hugging Face (SPEC §8)")
      .requiredOption("--from-hf <org/repo>", "Hugging Face repo to publish")
      .requiredOption("--publisher <name>", "ENS publisher name (e.g. qwen.enspack.eth)")
      .requiredOption("--version <semver>", "version string recorded in the manifest")
      .option("--revision <sha>", "HF commit SHA (default: resolve main)")
      .option("--webseed <url>", "extra BEP 19 webseed URL (repeatable)", collect)
      .option("--pin <pinner>", "pin adapter: kubo | pinata | seed")
      .option("--seed-node <url>", "seed node base URL")
      .option("--submit-hb", "POST the magnet to Hugging Bay as a decentralized fallback")
      .option("--dry-run", "do everything except pinning and on-chain sends")
      .option("--i-have-redistribution-rights", "override the license / gated-repo policy gate"),
  ).action(async (flags: PublishFlags) => {
    const pin = flags.pin;
    if (pin !== undefined && pin !== "kubo" && pin !== "pinata" && pin !== "seed") {
      throw new EnspackError("PUBLISH", `invalid --pin ${pin} (expected kubo|pinata|seed)`);
    }
    await runPublish(deps, flags);
  });
}
