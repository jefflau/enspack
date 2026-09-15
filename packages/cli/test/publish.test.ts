import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  EnspackError,
  type Manifest,
  type PublishInput,
  SELF_CID_PLACEHOLDER,
  namehashOf,
} from "@enspack/core";
import { describe, expect, it } from "vitest";
import type { CliHf } from "../src/types.js";
import { baseDeps, runCli, stubHf, stubPublisher, withTmp } from "./helpers.js";

const REAL_CID = `bafkrei${"b".repeat(52)}`;
const PREV_CID = `bafkrei${"c".repeat(52)}`;

function helloHf(): { hf: CliHf; hello: Buffer } {
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
  return { hf, hello };
}

async function wirePublish(
  deps: Awaited<ReturnType<typeof baseDeps>>["deps"],
  hello: Buffer,
  onPublish: (input: PublishInput) => void,
): Promise<void> {
  deps.hf = helloHf().hf;
  deps.downloader = {
    async fetch(_m: Manifest, dest: string) {
      await mkdir(dest, { recursive: true });
      await writeFile(join(dest, "hello.txt"), hello);
    },
  };
  const inner = stubPublisher();
  deps.publisherFactory = () => ({
    async publish(input) {
      onPublish(input);
      return inner.publish(input);
    },
  });
}

describe("publish versions[] cid (issue #30)", () => {
  it("writes SELF_CID_PLACEHOLDER on the last entry for a first publish", async () => {
    await withTmp(async (tmp) => {
      const { deps } = await baseDeps(tmp);
      const { hello } = helloHf();
      const seen: PublishInput[] = [];
      await wirePublish(deps, hello, (input) => {
        seen.push(input);
      });
      deps.resolverFactory = () => ({
        async resolve() {
          throw new EnspackError("RESOLVE", "no previous");
        },
      });
      const { code, stderr } = await runCli(deps, [
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
      expect(seen).toHaveLength(1);
      const versions = seen[0]?.manifest.versions ?? [];
      expect(versions).toHaveLength(1);
      expect(versions[0]?.cid).toBe(SELF_CID_PLACEHOLDER);
      expect(seen[0]?.manifestCid).not.toBe(SELF_CID_PLACEHOLDER);
    });
  });

  it("keeps previous real CIDs and placeholders only the new last entry", async () => {
    await withTmp(async (tmp) => {
      const { deps } = await baseDeps(tmp);
      const { hello } = helloHf();
      const seen: PublishInput[] = [];
      await wirePublish(deps, hello, (input) => {
        seen.push(input);
      });
      const digest = createHash("sha256").update(hello).digest("hex");
      const previous: Manifest["versions"] = [
        {
          version: "1.0.0",
          name: "v1-0-0.qwen--qwen2-5-7b-instruct.mirrors.enspack.eth",
          cid: REAL_CID,
          createdAt: "2026-09-14T00:00:00Z",
        },
        {
          version: "1.0.1",
          name: "v1-0-1.qwen--qwen2-5-7b-instruct.mirrors.enspack.eth",
          cid: SELF_CID_PLACEHOLDER,
          createdAt: "2026-09-15T00:00:00Z",
        },
      ];
      const lastPrev = previous[1];
      if (lastPrev === undefined) {
        throw new Error("fixture");
      }
      deps.resolverFactory = () => ({
        async resolve(ref: string) {
          return {
            name: ref,
            node: namehashOf(ref),
            cid: PREV_CID,
            magnet: null,
            spec: "enspack/0.1" as const,
            manifest: {
              spec: "enspack/0.1" as const,
              name: lastPrev.name,
              model: "qwen--qwen2-5-7b-instruct.mirrors.enspack.eth",
              publisher: "mirrors.enspack.eth",
              version: "1.0.1",
              createdAt: "2026-09-15T00:00:00Z",
              license: "apache-2.0",
              distribution: {
                infohash: "0".repeat(40),
                magnet: `magnet:?xt=urn:btih:${"0".repeat(40)}`,
                webseeds: [
                  "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct/resolve/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/",
                ],
              },
              files: [{ path: "hello.txt", size: hello.length, sha256: digest, role: "other" }],
              totalSize: hello.length,
              versions: previous,
            } as unknown as Manifest,
            manifestBytes: null,
          };
        },
      });
      const { code, stderr } = await runCli(deps, [
        "publish",
        "--from-hf",
        "Qwen/Qwen2.5-7B-Instruct",
        "--publisher",
        "mirrors.enspack.eth",
        "--version",
        "1.1.0",
        "--dry-run",
        "--json",
      ]);
      expect(code, stderr).toBe(0);
      const versions = seen[0]?.manifest.versions ?? [];
      expect(versions).toHaveLength(3);
      expect(versions[0]?.cid).toBe(REAL_CID);
      expect(versions[1]?.cid).toBe(PREV_CID);
      expect(versions[2]?.cid).toBe(SELF_CID_PLACEHOLDER);
      expect(versions[2]?.version).toBe("1.1.0");
      expect(seen[0]?.manifest.previous).toBe(PREV_CID);
    });
  });
});

describe("inspect / versions human cid annotation (issue #30)", () => {
  it("inspect human marks the latest cid and prints contenthash", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest, cid } = await baseDeps(tmp);
      const { code, stdout, stderr } = await runCli(deps, ["inspect", manifest.model]);
      expect(code).toBe(0);
      expect(stdout).toBe("");
      expect(stderr).toContain("(this manifest — see contenthash)");
      expect(stderr).toContain(`contenthash ${cid}`);
      expect(stderr).not.toContain(` ${SELF_CID_PLACEHOLDER}\n`);
    });
  });

  it("versions human marks the latest cid and prints latestCidFromContenthash", async () => {
    await withTmp(async (tmp) => {
      const { deps, manifest, cid } = await baseDeps(tmp);
      const { code, stdout, stderr } = await runCli(deps, ["versions", manifest.model]);
      expect(code).toBe(0);
      expect(stdout).toBe("");
      expect(stderr).toContain("(this manifest — see contenthash)");
      expect(stderr).toContain(`latestCidFromContenthash ${cid}`);
      expect(stderr).toContain("latest");
    });
  });
});
