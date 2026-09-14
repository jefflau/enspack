import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ensVersionFor, namehashOf } from "@enspack/core";
import { describe, expect, it } from "vitest";
import type { CliHf } from "../src/types.js";
import { baseDeps, copyFixture, runCli, stubHf, stubPublisher, withTmp } from "./helpers.js";

function freeze(text: string, tmp: string): string {
  return text.split(tmp).join("<tmp>");
}

describe("json payloads", () => {
  it("get --json writes only JSON on stdout", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest, cid } = await baseDeps(tmp);
      const dir = join(tmp, "out");
      const { code, stdout, stderr } = await runCli(deps, [
        "get",
        manifest.model,
        "--dir",
        dir,
        "--http-only",
        "--json",
      ]);
      expect(code).toBe(0);
      expect(stderr.length).toBeGreaterThan(0);
      expect(stdout.startsWith("{")).toBe(true);
      expect(stdout.endsWith("\n")).toBe(true);
      expect(stdout.slice(0, -1).includes("\n")).toBe(false);
      const payload = JSON.parse(stdout) as Record<string, unknown>;
      expect(payload).toEqual({
        name: manifest.model,
        node: namehashOf(manifest.model),
        cid,
        infohash: manifest.distribution.infohash,
        installedPath: dir,
        files: 3,
        totalSize: manifest.totalSize,
        verified: true,
      });
      expect(freeze(stdout, tmp)).toMatchSnapshot();
    });
  });

  it("inspect --json writes the full manifest and ensVersion", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest } = await baseDeps(tmp);
      const { code, stdout, stderr } = await runCli(deps, ["inspect", manifest.model, "--json"]);
      expect(code).toBe(0);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ ...manifest, ensVersion: "v1" });
      expect(stdout).toMatchSnapshot();
    });
  });

  it("versions --json marks the latest", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest } = await baseDeps(tmp);
      const { code, stdout } = await runCli(deps, ["versions", manifest.model, "--json"]);
      expect(code).toBe(0);
      expect(JSON.parse(stdout)).toEqual({
        versions: manifest.versions.map((v, i) => ({
          ...v,
          latest: i === manifest.versions.length - 1,
        })),
      });
      expect(stdout).toMatchSnapshot();
    });
  });

  it("verify --json on a matching directory", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest } = await baseDeps(tmp);
      const dir = join(tmp, "files");
      await copyFixture(dir);
      const { code, stdout, stderr } = await runCli(deps, [
        "verify",
        manifest.model,
        dir,
        "--json",
      ]);
      expect(code).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toBe(`${JSON.stringify({ ok: true })}\n`);
      expect(stdout).toMatchSnapshot();
    });
  });

  it("add --json writes the lock entry", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest, cid } = await baseDeps(tmp);
      const { code, stdout } = await runCli(deps, ["add", manifest.model, "--json"]);
      expect(code).toBe(0);
      const payload = JSON.parse(stdout) as Record<string, unknown>;
      expect(payload.key).toBe(manifest.model);
      expect(payload.cid).toBe(cid);
      expect(payload.resolved).toBe(manifest.name);
      expect(stdout).toMatchSnapshot();
    });
  });

  it("install --json reproduces the lockfile", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest } = await baseDeps(tmp);
      const add = await runCli(deps, ["add", manifest.model, "--json"]);
      expect(add.code).toBe(0);
      const dir = join(tmp, "installed");
      const { code, stdout } = await runCli(deps, [
        "install",
        "--dir",
        dir,
        "--http-only",
        "--json",
      ]);
      expect(code).toBe(0);
      const payload = JSON.parse(stdout) as { installed: unknown[] };
      expect(payload.installed).toHaveLength(1);
      expect(freeze(stdout, tmp)).toMatchSnapshot();
    });
  });

  it("update --json rewrites the entry", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest, cid } = await baseDeps(tmp);
      expect((await runCli(deps, ["add", manifest.model])).code).toBe(0);
      const { code, stdout } = await runCli(deps, ["update", "--json"]);
      expect(code).toBe(0);
      expect(JSON.parse(stdout)).toEqual({
        updated: [{ key: manifest.model, cid, resolved: manifest.name }],
      });
      expect(stdout).toMatchSnapshot();
    });
  });

  it("publish --json --dry-run uses an injected Publisher", async () => {
    await withTmp(async (tmp) => {
      const { deps } = await baseDeps(tmp);
      const hello = Buffer.from("hello-enspack\n");
      const digest = createHash("sha256").update(hello).digest("hex");
      const hf: CliHf = {
        ...stubHf(),
        async info() {
          return {
            gated: false,
            private: false,
            license: "apache-2.0",
            sha: "b".repeat(40),
            cardData: { license: "apache-2.0" },
          };
        },
        async resolveRevision() {
          return "b".repeat(40);
        },
        async buildFiles() {
          return [{ path: "hello.txt", size: hello.length, sha256: digest, role: "other" }];
        },
      };
      deps.hf = hf;
      deps.downloader = {
        async fetch(_m: import("@enspack/core").Manifest, dest: string) {
          const { writeFile } = await import("node:fs/promises");
          await mkdir(dest, { recursive: true });
          await writeFile(join(dest, "hello.txt"), hello);
        },
      };
      deps.publisherFactory = () => stubPublisher();
      const { code, stdout, stderr } = await runCli(deps, [
        "publish",
        "--from-hf",
        "Qwen/Qwen2.5-7B-Instruct",
        "--publisher",
        "mirrors.enspack.eth",
        "--version",
        "1.0.0",
        "--dry-run",
        "--json",
      ]);
      expect(code, stderr).toBe(0);
      const payload = JSON.parse(stdout) as Record<string, unknown>;
      expect(payload.name).toBe("v1-0-0.qwen--qwen2-5-7b-instruct.mirrors.enspack.eth");
      expect(payload.model).toBe("qwen--qwen2-5-7b-instruct.mirrors.enspack.eth");
      expect(typeof payload.cid).toBe("string");
      expect(typeof payload.infohash).toBe("string");
      expect(payload.txs).toEqual([]);
      expect(payload.ensVersion).toBe("v1");
      expect(payload.setup).toEqual([]);
      expect(stderr.includes("cid ")).toBe(true);
      expect(stderr).toMatch(/expected 3 transactions \(new model\)/);
      expect(stdout.replace(/bafkrei[a-z2-7]+/g, "<cid>")).toMatchSnapshot();
    });
  });

  it("inspect --chain sepolia uses ensVersion v2 unless overridden", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest } = await baseDeps(tmp);
      deps.env.SEPOLIA_RPC_URL = "http://127.0.0.1:1";
      let seen: string | undefined;
      const inner = deps.resolverFactory;
      deps.resolverFactory = (chain, rpcUrl) => {
        seen = ensVersionFor(chain, deps.env);
        return inner(chain, rpcUrl);
      };
      const v2 = await runCli(deps, ["inspect", manifest.model, "--json", "--chain", "sepolia"]);
      expect(v2.code).toBe(0);
      expect(seen).toBe("v2");
      expect((JSON.parse(v2.stdout) as { ensVersion: string }).ensVersion).toBe("v2");

      const flagged = await runCli(deps, [
        "inspect",
        manifest.model,
        "--json",
        "--chain",
        "sepolia",
        "--ens-version",
        "v1",
      ]);
      expect(flagged.code).toBe(0);
      expect(seen).toBe("v1");
      expect((JSON.parse(flagged.stdout) as { ensVersion: string }).ensVersion).toBe("v1");
    });
  });

  it("inspect honors ENSPACK_ENS_VERSION=v1 on sepolia", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest } = await baseDeps(tmp);
      deps.env.SEPOLIA_RPC_URL = "http://127.0.0.1:1";
      deps.env.ENSPACK_ENS_VERSION = "v1";
      let seen: string | undefined;
      const inner = deps.resolverFactory;
      deps.resolverFactory = (chain, rpcUrl) => {
        seen = ensVersionFor(chain, deps.env);
        return inner(chain, rpcUrl);
      };
      const r = await runCli(deps, ["inspect", manifest.model, "--json", "--chain", "sepolia"]);
      expect(r.code).toBe(0);
      expect(seen).toBe("v1");
      expect((JSON.parse(r.stdout) as { ensVersion: string }).ensVersion).toBe("v1");
    });
  });

  it("publish --json with a fake v2 publisher includes ensVersion and setup", async () => {
    await withTmp(async (tmp) => {
      const { deps } = await baseDeps(tmp);
      deps.env.SEPOLIA_RPC_URL = "http://127.0.0.1:1";
      const hello = Buffer.from("hello-enspack\n");
      const digest = createHash("sha256").update(hello).digest("hex");
      deps.hf = {
        ...stubHf(),
        async info() {
          return {
            gated: false,
            private: false,
            license: "apache-2.0",
            sha: "b".repeat(40),
            cardData: { license: "apache-2.0" },
          };
        },
        async resolveRevision() {
          return "b".repeat(40);
        },
        async buildFiles() {
          return [{ path: "hello.txt", size: hello.length, sha256: digest, role: "other" }];
        },
      };
      deps.downloader = {
        async fetch(_m: import("@enspack/core").Manifest, dest: string) {
          const { writeFile } = await import("node:fs/promises");
          await mkdir(dest, { recursive: true });
          await writeFile(join(dest, "hello.txt"), hello);
        },
      };
      const setup = [
        {
          to: "0x0000000000000000000000000000000000000002" as const,
          data: "0x" as const,
          description: "setup: VerifiableFactory.deployProxy(UserRegistryImpl)",
          gas: 80_000n,
        },
      ];
      deps.publisherFactory = () =>
        stubPublisher({
          txs: [],
          created: { model: true, version: true },
          setup,
          calls: [
            ...setup,
            {
              to: "0x0000000000000000000000000000000000000001",
              data: "0x",
              description: "multicall",
              gas: 123456n,
            },
          ],
        });
      const { code, stdout, stderr } = await runCli(deps, [
        "publish",
        "--from-hf",
        "Qwen/Qwen2.5-7B-Instruct",
        "--publisher",
        "mirrors.enspack.eth",
        "--version",
        "1.0.0",
        "--dry-run",
        "--json",
        "--chain",
        "sepolia",
      ]);
      expect(code, stderr).toBe(0);
      const payload = JSON.parse(stdout) as Record<string, unknown>;
      expect(payload.ensVersion).toBe("v2");
      expect(payload.setup).toEqual([
        {
          to: "0x0000000000000000000000000000000000000002",
          data: "0x",
          description: "setup: VerifiableFactory.deployProxy(UserRegistryImpl)",
          gas: "80000",
        },
      ]);
      expect(stderr).toMatch(/setup: VerifiableFactory\.deployProxy\(UserRegistryImpl\)/);
      expect(stderr).toMatch(/expected 5 transactions \(4 new model \+ 1 setup\)/);
    });
  });

  it("invalid --ens-version exits RESOLVE", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest } = await baseDeps(tmp);
      const { code, stderr } = await runCli(deps, [
        "inspect",
        manifest.model,
        "--ens-version",
        "v3",
      ]);
      expect(code).toBe(2);
      expect(stderr).toMatch(/must be v1 or v2/);
    });
  });

  it("seed --json prints infohash and state", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest } = await baseDeps(tmp);
      deps.fetch = async () =>
        new Response(
          JSON.stringify({ infohash: manifest.distribution.infohash, state: "downloading" }),
          {
            status: 202,
            headers: { "content-type": "application/json" },
          },
        );
      const { code, stdout } = await runCli(deps, [
        "seed",
        manifest.model,
        "--seed-node",
        "http://127.0.0.1:9",
        "--json",
      ]);
      expect(code).toBe(0);
      expect(stdout).toBe(
        `${JSON.stringify({ infohash: manifest.distribution.infohash, state: "downloading" })}\n`,
      );
      expect(stdout).toMatchSnapshot();
    });
  });
});
