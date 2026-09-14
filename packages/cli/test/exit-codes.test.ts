import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EnspackError, writeLock } from "@enspack/core";
import { licenseGate } from "@enspack/hf";
import { describe, expect, it } from "vitest";
import type { CliHf } from "../src/types.js";
import {
  baseDeps,
  magnetOnlyResolver,
  runCli,
  stubHf,
  throwingResolver,
  withTmp,
} from "./helpers.js";

describe("exit codes", () => {
  it("unresolvable ref → 2", async () => {
    await withTmp(async (tmp) => {
      const { deps } = await baseDeps(tmp);
      deps.resolverFactory = throwingResolver("RESOLVE", "no such name");
      const { code, stdout, stderr } = await runCli(deps, [
        "inspect",
        "missing.enspack.eth",
        "--json",
      ]);
      expect(code).toBe(2);
      expect(stdout).toBe("");
      expect(stderr).toContain("no such name");
    });
  });

  it("lock CID mismatch → 3 and mentions enspack update", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest } = await baseDeps(tmp);
      await writeLock(
        {
          lockfileVersion: 1,
          models: {
            [manifest.model]: {
              resolved: manifest.name,
              cid: `bafkrei${"b".repeat(52)}`,
              infohash: manifest.distribution.infohash,
              totalSize: manifest.totalSize,
              select: ["*"],
            },
          },
        },
        join(tmp, "enspack.lock"),
      );
      const { code, stderr } = await runCli(deps, [
        "get",
        manifest.model,
        "--dir",
        join(tmp, "out"),
        "--json",
      ]);
      expect(code).toBe(3);
      expect(stderr).toMatch(/enspack update/);
    });
  });

  it("verify failure → 3, prints the path, creates quarantine", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest } = await baseDeps(tmp);
      deps.downloader = {
        async fetch(_m: import("@enspack/core").Manifest, dest: string) {
          await mkdir(dest, { recursive: true });
          await writeFile(join(dest, "config.json"), "CORRUPT");
          await writeFile(join(dest, "model.safetensors"), "CORRUPT");
          await writeFile(join(dest, "tokenizer.json"), "CORRUPT");
        },
      };
      const dir = join(tmp, "out");
      const { code, stderr } = await runCli(deps, [
        "get",
        manifest.model,
        "--dir",
        dir,
        "--http-only",
      ]);
      expect(code).toBe(3);
      expect(stderr).toMatch(/config\.json/);
      const q = join(dir, ".enspack-quarantine", manifest.distribution.infohash);
      expect(existsSync(q)).toBe(true);
    });
  });

  it("downloader throwing DOWNLOAD → 4", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest } = await baseDeps(tmp);
      deps.downloader = {
        async fetch() {
          throw new EnspackError("DOWNLOAD", "aria2c failed");
        },
      };
      const { code, stderr } = await runCli(deps, [
        "get",
        manifest.model,
        "--dir",
        join(tmp, "out"),
        "--http-only",
      ]);
      expect(code).toBe(4);
      expect(stderr).toContain("aria2c failed");
    });
  });

  it("publish failure → 5", async () => {
    await withTmp(async (tmp) => {
      const { deps } = await baseDeps(tmp);
      deps.publisherFactory = () => ({
        async publish() {
          throw new EnspackError("PUBLISH", "on-chain send failed");
        },
      });
      deps.hf = {
        ...stubHf(),
        async buildFiles() {
          return [
            {
              path: "hello.txt",
              size: 1,
              sha256: "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b",
              role: "other",
            },
          ];
        },
      };
      deps.downloader = {
        async fetch(_m: import("@enspack/core").Manifest, dest: string) {
          await mkdir(dest, { recursive: true });
          await writeFile(join(dest, "hello.txt"), "1");
        },
      };
      const { code, stderr } = await runCli(deps, [
        "publish",
        "--from-hf",
        "Qwen/Tiny",
        "--publisher",
        "qwen.enspack.eth",
        "--version",
        "1.0.0",
        "--pin",
        "seed",
        "--seed-node",
        "http://127.0.0.1:9",
      ]);
      expect(code).toBe(5);
      expect(stderr).toContain("on-chain send failed");
    });
  });

  it("license gate llama3.1 → 5 and passes with --i-have-redistribution-rights", async () => {
    await withTmp(async (tmp) => {
      const { deps } = await baseDeps(tmp);
      const gated: CliHf = {
        ...stubHf(),
        async info() {
          return {
            gated: false,
            private: false,
            license: "llama3.1",
            sha: "c".repeat(40),
            cardData: { license: "llama3.1" },
          };
        },
        licenseGate: (license, opts) => licenseGate(license, opts),
        async buildFiles() {
          return [
            {
              path: "hello.txt",
              size: 1,
              sha256: "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b",
              role: "other",
            },
          ];
        },
      };
      deps.hf = gated;
      deps.downloader = {
        async fetch(_m: import("@enspack/core").Manifest, dest: string) {
          await mkdir(dest, { recursive: true });
          await writeFile(join(dest, "hello.txt"), "1");
        },
      };
      const denied = await runCli(deps, [
        "publish",
        "--from-hf",
        "meta/llama",
        "--publisher",
        "meta.enspack.eth",
        "--version",
        "1.0.0",
        "--dry-run",
      ]);
      expect(denied.code).toBe(5);
      expect(denied.stderr).toMatch(/llama3\.1|allowlist/);

      const allowed = await runCli(deps, [
        "publish",
        "--from-hf",
        "meta/llama",
        "--publisher",
        "meta.enspack.eth",
        "--version",
        "1.0.0",
        "--dry-run",
        "--i-have-redistribution-rights",
        "--json",
      ]);
      expect(allowed.code, allowed.stderr).toBe(0);
    });
  });

  it("no contenthash without --allow-unverified → 3; with the flag the magnet path is taken", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest } = await baseDeps(tmp);
      const magnet = manifest.distribution.magnet;
      deps.resolverFactory = magnetOnlyResolver(manifest.model, magnet);
      let fetched = false;
      deps.downloader = {
        async fetch() {
          fetched = true;
        },
      };
      const denied = await runCli(deps, ["get", manifest.model, "--dir", join(tmp, "out")]);
      expect(denied.code).toBe(3);
      expect(denied.stderr).toMatch(/--allow-unverified/);
      expect(fetched).toBe(false);

      const allowed = await runCli(deps, [
        "get",
        manifest.model,
        "--dir",
        join(tmp, "out2"),
        "--allow-unverified",
      ]);
      expect(allowed.code, allowed.stderr).toBe(0);
      expect(fetched).toBe(true);
      expect(allowed.stderr).toMatch(/WARNING/);
    });
  });

  it("seed 403/422 → 5 with the server error body", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest } = await baseDeps(tmp);
      deps.fetch = async () =>
        new Response(JSON.stringify({ error: "policy denied", code: "NOT_ALLOWLISTED" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        });
      const denied = await runCli(deps, [
        "seed",
        manifest.model,
        "--seed-node",
        "http://127.0.0.1:9",
      ]);
      expect(denied.code).toBe(5);
      expect(denied.stderr).toContain("policy denied");
      expect(denied.stderr).toContain("NOT_ALLOWLISTED");

      deps.fetch = async () =>
        new Response(JSON.stringify({ error: "unknown name", code: "UNKNOWN_NAME" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        });
      const unprocessable = await runCli(deps, [
        "seed",
        manifest.model,
        "--seed-node",
        "http://127.0.0.1:9",
      ]);
      expect(unprocessable.code).toBe(5);
      expect(unprocessable.stderr).toContain("unknown name");
    });
  });

  it("missing license → 5", async () => {
    await withTmp(async (tmp) => {
      const { deps } = await baseDeps(tmp);
      deps.hf = {
        ...stubHf(),
        async info() {
          return {
            gated: false,
            private: false,
            license: null,
            sha: "d".repeat(40),
            cardData: null,
          };
        },
      };
      const { code, stderr } = await runCli(deps, [
        "publish",
        "--from-hf",
        "org/repo",
        "--publisher",
        "org.enspack.eth",
        "--version",
        "1.0.0",
        "--dry-run",
      ]);
      expect(code).toBe(5);
      expect(stderr).toMatch(/missing|allowlist/);
    });
  });
});
