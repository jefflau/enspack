import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/lib/api.js";
import { FixtureIndexClient, HttpIndexClient } from "../src/lib/client.js";
import { readConfig } from "../src/lib/config.js";
import { ensAppUrl, firstLabel, formatBytes, shortHex } from "../src/lib/format.js";
import { demoFixtures } from "./helpers.js";

describe("config", () => {
  it("defaults to sepolia + http and strips trailing slashes", () => {
    const c = readConfig({ VITE_INDEX_URL: "https://idx.example/" } as ImportMetaEnv);
    expect(c.chain).toBe("sepolia");
    expect(c.dataSource).toBe("http");
    expect(c.indexUrl).toBe("https://idx.example");
  });

  it("honours mainnet + demo", () => {
    const c = readConfig({ VITE_CHAIN: "mainnet", VITE_DATA_SOURCE: "demo" } as ImportMetaEnv);
    expect(c.chain).toBe("mainnet");
    expect(c.dataSource).toBe("demo");
  });
});

describe("format", () => {
  it("formats bytes in decimal units", () => {
    expect(formatBytes(663)).toBe("663 B");
    expect(formatBytes(15242807270)).toBe("15.2 GB");
    expect(formatBytes(2471645608)).toBe("2.47 GB");
  });
  it("shortens hex and keeps short values intact", () => {
    expect(shortHex("0x1234567890abcdef")).toBe("0x1234…cdef");
    expect(shortHex("abc")).toBe("abc");
  });
  it("derives labels and ENS app urls per chain", () => {
    expect(firstLabel("jeff.enspack.eth")).toBe("jeff");
    expect(ensAppUrl("sepolia", "x.eth")).toBe("https://sepolia.app.ens.domains/x.eth");
    expect(ensAppUrl("mainnet", "x.eth")).toBe("https://app.ens.domains/x.eth");
  });
});

describe("FixtureIndexClient", () => {
  const client = new FixtureIndexClient(demoFixtures);

  it("lists, filters by publisher and searches by display name", async () => {
    expect((await client.listNames()).items).toHaveLength(3);
    const mirrors = await client.listNames({ publisher: "mirrors.enspack.eth" });
    expect(mirrors.items.map((i) => i.publisher)).toEqual([
      "mirrors.enspack.eth",
      "mirrors.enspack.eth",
    ]);
    const qwen = await client.listNames({ q: "Qwen2.5" });
    expect(qwen.items).toHaveLength(1);
  });

  it("resolves a version name to its model detail and 404s unknown names", async () => {
    const d = await client.getName("v0-1-0.tiny-random.jeff.enspack.eth");
    expect(d.model).toBe("tiny-random.jeff.enspack.eth");
    await expect(client.getName("nope.eth")).rejects.toMatchObject({ status: 404 });
  });

  it("returns null attestation for non-registrar publishers", async () => {
    expect(await client.getAttestation("mirrors")).toBeNull();
    expect(await client.getAttestation("jeff")).not.toBeNull();
  });
});

describe("HttpIndexClient", () => {
  it("builds query strings and surfaces indexer error codes", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ error: "invalid cursor", code: "INVALID" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const client = new HttpIndexClient("https://idx", "https://reg", fetchImpl);
    const err = await client.listNames({ q: "a b", limit: 5 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("INVALID");
    expect(calls[0]).toBe("https://idx/v1/names?q=a+b&limit=5");
  });

  it("maps registrar 404 to null and network failure to NETWORK", async () => {
    const notFound = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
    const client = new HttpIndexClient("https://idx", "https://reg", notFound);
    expect(await client.getAttestation("x")).toBeNull();
    const down = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const c2 = new HttpIndexClient("https://idx", "https://reg", down);
    await expect(c2.listPublishers()).rejects.toMatchObject({ status: 0, code: "NETWORK" });
  });
});
