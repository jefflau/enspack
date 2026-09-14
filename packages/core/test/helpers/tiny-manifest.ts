import { hexToBytes } from "viem";
import { versionLabel } from "../../src/labels.js";

export const PINNED_CID = "bafkreibtpfyx25ckr5fj2r7tfh6m6bdmzqnb3kq7lywlqs53peqq6h2ble";
/** `@ensdomains/content-hash` encode("ipfs", PINNED_CID), computed once and pinned. */
export const PINNED_CONTENTHASH =
  "0xe301015512203379717d744a8f4a9d47f329fccf046ccc1a1daa1f5e2cb84bbb79210f1f4159" as const;
export const SWARM_CONTENTHASH =
  "0xe40101701b20d1de9994b4d039f6548d191eb26786769f580809256b4685ef316805265ea162" as const;

export const VERSION_NAME = "v1-0-0.tiny-model.enspack-test.eth";
export const VERSION_1_1_NAME = "v1-1-0.tiny-model.enspack-test.eth";
export const MODEL_NAME = "tiny-model.enspack-test.eth";
export const PUBLISHER_NAME = "enspack-test.eth";
export const MAGNET = "magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const FAKE_RESOLVER = "0x1111111111111111111111111111111111111111" as const;

export function tinyManifest(overrides?: {
  name?: string;
  model?: string;
  publisher?: string;
  spec?: string;
  version?: string;
  magnet?: string;
  createdAt?: string;
}): Record<string, unknown> {
  const model = overrides?.model ?? MODEL_NAME;
  const publisher = overrides?.publisher ?? PUBLISHER_NAME;
  const spec = overrides?.spec ?? "enspack/0.1";
  const version = overrides?.version ?? "1.0.0";
  const name = overrides?.name ?? `${versionLabel(version)}.${model}`;
  const magnet = overrides?.magnet ?? MAGNET;
  const createdAt = overrides?.createdAt ?? "2026-09-14T00:00:00Z";
  return {
    spec,
    name,
    model,
    publisher,
    version,
    createdAt,
    license: "mit",
    distribution: {
      infohash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      magnet,
      webseeds: ["https://example.com/files/"],
    },
    files: [
      {
        path: "config.json",
        size: 2,
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      },
    ],
    totalSize: 2,
    versions: [
      {
        version,
        name,
        cid: PINNED_CID,
        createdAt,
      },
    ],
  };
}

export function dnsDecodeName(hex: `0x${string}`): string {
  const bytes = hexToBytes(hex);
  const labels: string[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const len = bytes[offset];
    if (len === undefined || len === 0) {
      break;
    }
    offset += 1;
    labels.push(new TextDecoder().decode(bytes.subarray(offset, offset + len)));
    offset += len;
  }
  return labels.join(".");
}
