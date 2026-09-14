import {
  type Hex,
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  namehash,
  zeroAddress,
} from "viem";
import { sepolia } from "viem/chains";
import { describe, expect, it } from "vitest";
import { SPEC_STRING, TEXT_KEYS } from "../../src/constants.js";
import { contenthashResolverAbi, textResolverAbi } from "../../src/ens/abis.js";
import { universalResolverV2Abi } from "../../src/ens/v2/abis.js";
import {
  EnspackError,
  type ManifestStore,
  canonicalJson,
  createResolver,
  ensV2ConfigFor,
} from "../../src/index.js";
import {
  FAKE_RESOLVER,
  MAGNET,
  MODEL_NAME,
  PINNED_CID,
  PINNED_CONTENTHASH,
  PUBLISHER_NAME,
  VERSION_NAME,
  dnsDecodeName,
  tinyManifest,
} from "../helpers/tiny-manifest.js";

const UR = ensV2ConfigFor("sepolia", {}).universalResolver;

type Fixture = {
  resolver?: `0x${string}`;
  contenthash?: `0x${string}`;
  texts?: Record<string, string>;
};

function tryDecode(
  abi: typeof universalResolverV2Abi | typeof contenthashResolverAbi | typeof textResolverAbi,
  data: Hex,
) {
  try {
    return decodeFunctionData({ abi, data });
  } catch {
    return undefined;
  }
}

function createV2Transport(
  fixtures: Record<string, Fixture>,
  calls: { count: number; tos?: string[] },
  ur = UR,
) {
  return custom({
    async request({ method, params }) {
      calls.count += 1;
      if (method === "eth_chainId") {
        return "0xaa36a7";
      }
      if (method !== "eth_call") {
        throw new Error(`unexpected method ${method}`);
      }
      const call = (params as [{ to?: string; data?: Hex }])[0];
      const to = call?.to;
      const data = call?.data;
      if (to === undefined || data === undefined) {
        throw new Error("eth_call missing to/data");
      }
      const toLc = to.toLowerCase();
      calls.tos?.push(toLc);
      if (toLc !== ur.toLowerCase()) {
        throw new Error(`unexpected eth_call to ${to}`);
      }
      const decoded = tryDecode(universalResolverV2Abi, data);
      if (decoded === undefined) {
        throw new Error(`unhandled UR selector ${data.slice(0, 10)}`);
      }
      if (decoded.functionName === "findResolver") {
        const name = dnsDecodeName(decoded.args[0]);
        const fixture = fixtures[name];
        const resolver = fixture?.resolver ?? zeroAddress;
        return encodeFunctionResult({
          abi: universalResolverV2Abi,
          functionName: "findResolver",
          result: [resolver, namehash(name), 0n],
        });
      }
      if (decoded.functionName === "resolve") {
        const name = dnsDecodeName(decoded.args[0]);
        const inner = decoded.args[1];
        const fixture = fixtures[name];
        const resolver = fixture?.resolver ?? zeroAddress;
        const contenthashCall = tryDecode(contenthashResolverAbi, inner);
        if (contenthashCall?.functionName === "contenthash") {
          const hash = fixture?.contenthash ?? "0x";
          const innerResult = encodeFunctionResult({
            abi: contenthashResolverAbi,
            functionName: "contenthash",
            result: hash,
          });
          return encodeFunctionResult({
            abi: universalResolverV2Abi,
            functionName: "resolve",
            result: [innerResult, resolver],
          });
        }
        const textCall = tryDecode(textResolverAbi, inner);
        if (textCall?.functionName === "text") {
          const key = textCall.args[1];
          const value = fixture?.texts?.[key] ?? "";
          const innerResult = encodeFunctionResult({
            abi: textResolverAbi,
            functionName: "text",
            result: value,
          });
          return encodeFunctionResult({
            abi: universalResolverV2Abi,
            functionName: "resolve",
            result: [innerResult, resolver],
          });
        }
        throw new Error(`unhandled UR inner call ${inner.slice(0, 10)}`);
      }
      throw new Error(`unhandled UR function ${decoded.functionName}`);
    },
  });
}

function makeResolver(fixtures: Record<string, Fixture>, store?: ManifestStore, ur = UR) {
  const calls = { count: 0, tos: [] as string[] };
  const client = createPublicClient({
    chain: sepolia,
    transport: createV2Transport(fixtures, calls, ur),
  });
  const resolver =
    store === undefined
      ? createResolver({
          client,
          chain: "sepolia",
          ensVersion: "v2",
          ensV2: { universalResolver: ur },
        })
      : createResolver({
          client,
          chain: "sepolia",
          ensVersion: "v2",
          store,
          ensV2: { universalResolver: ur },
        });
  return { resolver, calls };
}

function bytesStore(bytes: Uint8Array, expectedCid?: string): ManifestStore {
  return {
    async put() {
      throw new Error("put is unused in WP-14 tests");
    },
    async getVerified(cid) {
      if (expectedCid !== undefined && cid !== expectedCid) {
        throw new EnspackError("VERIFY", "cid mismatch");
      }
      return bytes;
    },
  };
}

const fullRecords: Fixture = {
  resolver: FAKE_RESOLVER,
  contenthash: PINNED_CONTENTHASH,
  texts: {
    [TEXT_KEYS.spec]: SPEC_STRING,
    [TEXT_KEYS.magnet]: MAGNET,
  },
};

describe("createResolver ensVersion v2 (mock transport)", () => {
  it("resolves a version name via UR findResolver + resolve", async () => {
    const manifest = tinyManifest();
    const bytes = canonicalJson(manifest);
    const { resolver } = makeResolver(
      { [VERSION_NAME]: fullRecords },
      bytesStore(bytes, PINNED_CID),
    );
    const resolved = await resolver.resolve(`${MODEL_NAME}@1.0.0`);
    expect(resolved.name).toBe(VERSION_NAME);
    expect(resolved.cid).toBe(PINNED_CID);
    expect(resolved.magnet).toBe(MAGNET);
    expect(resolved.spec).toBe(SPEC_STRING);
    expect(resolved.manifest?.name).toBe(VERSION_NAME);
    expect(resolved.manifestBytes).toEqual(bytes);
  });

  it("resolves a model name and matches manifest.model", async () => {
    const manifest = tinyManifest();
    const bytes = canonicalJson(manifest);
    const { resolver } = makeResolver({ [MODEL_NAME]: fullRecords }, bytesStore(bytes, PINNED_CID));
    const resolved = await resolver.resolve(MODEL_NAME);
    expect(resolved.name).toBe(MODEL_NAME);
    expect(resolved.cid).toBe(PINNED_CID);
    expect(resolved.manifest?.model).toBe(MODEL_NAME);
  });

  it("throws VERIFY when the manifest name does not match the resolved node", async () => {
    const manifest = tinyManifest({
      name: "v9-9-9.other.enspack-test.eth",
      model: "other.enspack-test.eth",
      publisher: PUBLISHER_NAME,
    });
    const bytes = canonicalJson(manifest);
    const { resolver } = makeResolver(
      { [VERSION_NAME]: fullRecords },
      bytesStore(bytes, PINNED_CID),
    );
    await expect(resolver.resolve(VERSION_NAME)).rejects.toMatchObject({
      code: "VERIFY",
      message: "manifest name does not match resolved name",
    });
  });

  it("returns magnet fallback when contenthash is empty and MAGNET_RE matches", async () => {
    const { resolver } = makeResolver({
      [MODEL_NAME]: {
        resolver: FAKE_RESOLVER,
        contenthash: "0x",
        texts: { [TEXT_KEYS.magnet]: MAGNET, [TEXT_KEYS.spec]: SPEC_STRING },
      },
    });
    const resolved = await resolver.resolve(MODEL_NAME);
    expect(resolved.cid).toBeNull();
    expect(resolved.magnet).toBe(MAGNET);
    expect(resolved.spec).toBe(SPEC_STRING);
    expect(resolved.manifest).toBeNull();
  });

  it("throws RESOLVE when a resolver exists but there are no enspack records", async () => {
    const { resolver } = makeResolver({
      [MODEL_NAME]: { resolver: FAKE_RESOLVER, contenthash: "0x", texts: {} },
    });
    await expect(resolver.resolve(MODEL_NAME)).rejects.toMatchObject({
      code: "RESOLVE",
      message: `${MODEL_NAME} has no enspack records`,
    });
  });

  it("throws RESOLVE when findResolver returns the zero address", async () => {
    const { resolver } = makeResolver({});
    await expect(resolver.resolve("missing.enspack.eth")).rejects.toMatchObject({
      code: "RESOLVE",
      message: "missing.enspack.eth has no resolver",
    });
  });

  it("reads via cfg.universalResolver, not viem getEnsText on the chain UR", async () => {
    const override = "0x2222222222222222222222222222222222222222" as const;
    const { resolver, calls } = makeResolver({ [VERSION_NAME]: fullRecords }, undefined, override);
    const resolved = await resolver.resolve(VERSION_NAME);
    expect(resolved.cid).toBe(PINNED_CID);
    expect(calls.tos?.every((to) => to === override.toLowerCase())).toBe(true);
  });
});
