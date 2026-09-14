import {
  type Hex,
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  namehash,
  zeroAddress,
} from "viem";
import { mainnet } from "viem/chains";
import { describe, expect, it } from "vitest";
import { ENS_REGISTRY, SPEC_STRING, TEXT_KEYS } from "../src/constants.js";
import {
  contenthashResolverAbi,
  ensRegistryAbi,
  textResolverAbi,
  universalResolverAbi,
} from "../src/ens/abis.js";
import {
  EnspackError,
  type ManifestStore,
  canonicalJson,
  createResolver,
  decodeContenthashToCid,
  dnsEncodeName,
  encodeIpfsContenthash,
  validateManifest,
} from "../src/index.js";
import {
  FAKE_RESOLVER,
  MAGNET,
  MODEL_NAME,
  PINNED_CID,
  PINNED_CONTENTHASH,
  PUBLISHER_NAME,
  SWARM_CONTENTHASH,
  VERSION_NAME,
  dnsDecodeName,
  tinyManifest,
} from "./helpers/tiny-manifest.js";

const UR = mainnet.contracts.ensUniversalResolver.address;

type Fixture = {
  resolver?: `0x${string}`;
  contenthash?: `0x${string}`;
  texts?: Record<string, string>;
};

function tryDecode(
  abi:
    | typeof universalResolverAbi
    | typeof contenthashResolverAbi
    | typeof textResolverAbi
    | typeof ensRegistryAbi,
  data: Hex,
) {
  try {
    return decodeFunctionData({ abi, data });
  } catch {
    return undefined;
  }
}

function createCountingTransport(fixtures: Record<string, Fixture>, calls: { count: number }) {
  return custom({
    async request({ method, params }) {
      calls.count += 1;
      if (method === "eth_chainId") {
        return "0x1";
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

      if (toLc === UR.toLowerCase()) {
        const decoded = tryDecode(universalResolverAbi, data);
        if (decoded === undefined) {
          throw new Error(`unhandled UR selector ${data.slice(0, 10)}`);
        }
        if (decoded.functionName === "findResolver") {
          const name = dnsDecodeName(decoded.args[0]);
          const fixture = fixtures[name];
          const resolver = fixture?.resolver ?? zeroAddress;
          return encodeFunctionResult({
            abi: universalResolverAbi,
            functionName: "findResolver",
            result: [resolver, namehash(name), 0n],
          });
        }
        if (decoded.functionName === "resolve" || decoded.functionName === "resolveWithGateways") {
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
              abi: universalResolverAbi,
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
              abi: universalResolverAbi,
              functionName: decoded.functionName,
              result: [innerResult, resolver],
            });
          }
          throw new Error(`unhandled UR inner call ${inner.slice(0, 10)}`);
        }
      }

      if (toLc === ENS_REGISTRY.toLowerCase()) {
        const decoded = tryDecode(ensRegistryAbi, data);
        if (decoded?.functionName === "resolver") {
          const node = decoded.args[0];
          for (const [name, fixture] of Object.entries(fixtures)) {
            if (namehash(name) === node) {
              return encodeFunctionResult({
                abi: ensRegistryAbi,
                functionName: "resolver",
                result: fixture.resolver ?? zeroAddress,
              });
            }
          }
          return encodeFunctionResult({
            abi: ensRegistryAbi,
            functionName: "resolver",
            result: zeroAddress,
          });
        }
      }

      const contenthashCall = tryDecode(contenthashResolverAbi, data);
      if (contenthashCall?.functionName === "contenthash") {
        const node = contenthashCall.args[0];
        for (const [name, fixture] of Object.entries(fixtures)) {
          if (namehash(name) === node) {
            return encodeFunctionResult({
              abi: contenthashResolverAbi,
              functionName: "contenthash",
              result: fixture.contenthash ?? "0x",
            });
          }
        }
        return encodeFunctionResult({
          abi: contenthashResolverAbi,
          functionName: "contenthash",
          result: "0x",
        });
      }
      const textCall = tryDecode(textResolverAbi, data);
      if (textCall?.functionName === "text") {
        const node = textCall.args[0];
        const key = textCall.args[1];
        for (const [name, fixture] of Object.entries(fixtures)) {
          if (namehash(name) === node) {
            return encodeFunctionResult({
              abi: textResolverAbi,
              functionName: "text",
              result: fixture.texts?.[key] ?? "",
            });
          }
        }
        return encodeFunctionResult({
          abi: textResolverAbi,
          functionName: "text",
          result: "",
        });
      }

      throw new Error(`unhandled eth_call to ${to} ${data.slice(0, 10)}`);
    },
  });
}

function makeResolver(fixtures: Record<string, Fixture>, store?: ManifestStore) {
  const calls = { count: 0 };
  const client = createPublicClient({
    chain: mainnet,
    transport: createCountingTransport(fixtures, calls),
  });
  const resolver =
    store === undefined
      ? createResolver({ client, chain: "mainnet" })
      : createResolver({ client, chain: "mainnet", store });
  return { resolver, calls };
}

function bytesStore(bytes: Uint8Array, expectedCid?: string): ManifestStore {
  return {
    async put() {
      throw new Error("put is unused in WP-02 tests");
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

describe("dnsEncodeName", () => {
  it("DNS-encodes foo.eth", () => {
    expect(dnsEncodeName("foo.eth")).toBe("0x03666f6f0365746800");
    expect(dnsDecodeName(dnsEncodeName(VERSION_NAME))).toBe(VERSION_NAME);
  });
});

describe("contenthash encode/decode", () => {
  it("round-trips the pinned CID", () => {
    expect(encodeIpfsContenthash(PINNED_CID)).toBe(PINNED_CONTENTHASH);
    expect(decodeContenthashToCid(PINNED_CONTENTHASH)).toBe(PINNED_CID);
    expect(decodeContenthashToCid(PINNED_CONTENTHASH.slice(2))).toBe(PINNED_CID);
  });

  it("rejects a non-ipfs protocol", () => {
    expect(() => decodeContenthashToCid(SWARM_CONTENTHASH)).toThrow(EnspackError);
    try {
      decodeContenthashToCid(SWARM_CONTENTHASH);
    } catch (e) {
      expect(e).toMatchObject({ code: "RESOLVE", message: "contenthash is not ipfs" });
    }
  });
});

describe("createResolver (mock transport)", () => {
  it("resolves a version name and matches manifest.name", async () => {
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

  it("throws VERIFY when manifest.spec is wrong", async () => {
    const manifest = tinyManifest({ spec: "enspack/0.2" });
    const bytes = new TextEncoder().encode(JSON.stringify(manifest));
    const { resolver } = makeResolver(
      { [VERSION_NAME]: fullRecords },
      bytesStore(bytes, PINNED_CID),
    );
    await expect(resolver.resolve(VERSION_NAME)).rejects.toMatchObject({ code: "VERIFY" });
  });

  it("propagates a store hash mismatch", async () => {
    const store: ManifestStore = {
      async put() {
        throw new Error("unused");
      },
      async getVerified() {
        throw new EnspackError("VERIFY", "cid mismatch");
      },
    };
    const { resolver } = makeResolver({ [VERSION_NAME]: fullRecords }, store);
    await expect(resolver.resolve(VERSION_NAME)).rejects.toMatchObject({
      code: "VERIFY",
      message: "cid mismatch",
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

  it("throws RESOLVE when the magnet does not match MAGNET_RE", async () => {
    const { resolver } = makeResolver({
      [MODEL_NAME]: {
        resolver: FAKE_RESOLVER,
        contenthash: "0x",
        texts: { [TEXT_KEYS.magnet]: "magnet:?xt=urn:btih:not-hex" },
      },
    });
    await expect(resolver.resolve(MODEL_NAME)).rejects.toMatchObject({ code: "RESOLVE" });
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

  it("throws RESOLVE before any RPC when normalization changes a label", async () => {
    const { resolver, calls } = makeResolver({});
    await expect(resolver.resolve("Qwen.enspack.eth")).rejects.toMatchObject({ code: "RESOLVE" });
    expect(calls.count).toBe(0);
  });

  it("throws RESOLVE when the name has no resolver", async () => {
    const { resolver } = makeResolver({});
    await expect(resolver.resolve("missing.enspack.eth")).rejects.toMatchObject({
      code: "RESOLVE",
      message: "missing.enspack.eth has no resolver",
    });
  });

  it("returns cid with null manifest when no store is provided", async () => {
    const { resolver } = makeResolver({ [VERSION_NAME]: fullRecords });
    const resolved = await resolver.resolve(VERSION_NAME);
    expect(resolved.cid).toBe(PINNED_CID);
    expect(resolved.manifest).toBeNull();
    expect(resolved.manifestBytes).toBeNull();
  });

  it("rejects a non-ipfs contenthash with RESOLVE", async () => {
    const { resolver } = makeResolver({
      [MODEL_NAME]: { resolver: FAKE_RESOLVER, contenthash: SWARM_CONTENTHASH },
    });
    await expect(resolver.resolve(MODEL_NAME)).rejects.toMatchObject({
      code: "RESOLVE",
      message: "contenthash is not ipfs",
    });
  });
});

describe("tinyManifest fixture", () => {
  it("is schema-valid", () => {
    expect(validateManifest(tinyManifest()).spec).toBe(SPEC_STRING);
  });
});
