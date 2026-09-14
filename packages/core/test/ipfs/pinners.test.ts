import { describe, expect, it } from "vitest";
import {
  type EnspackError,
  createManifestStore,
  kuboPinner,
  manifestCid,
  pinataPinner,
  seedNodePinner,
} from "../../src/index.js";
import { listen, readRequestBody, unixfsFileBlock } from "./helpers.js";

const PAYLOAD = new TextEncoder().encode("pin-me-please");
const PINATA_JWT = "test-jwt-not-for-logs";

function rewriteFetch(origin: string): typeof fetch {
  return async (input, init) => {
    const orig =
      typeof input === "string"
        ? new URL(input)
        : input instanceof URL
          ? input
          : new URL(input.url);
    const rewritten = new URL(`${orig.pathname}${orig.search}`, origin);
    const headers = new Headers(init?.headers);
    if (input instanceof Request) {
      for (const [key, value] of input.headers) {
        if (!headers.has(key)) {
          headers.set(key, value);
        }
      }
    }
    return fetch(rewritten, { ...init, headers });
  };
}

describe("kuboPinner", () => {
  it("POSTs multipart block/put with cid-codec=raw and returns Key", async () => {
    const cid = await manifestCid(PAYLOAD);
    let method = "";
    let url = "";
    let contentType = "";
    let body: Buffer = Buffer.alloc(0);

    const { origin } = await listen(async (req, res) => {
      method = req.method ?? "";
      url = req.url ?? "";
      contentType = req.headers["content-type"] ?? "";
      body = await readRequestBody(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ Key: cid, Size: PAYLOAD.byteLength }));
    });

    const pinner = kuboPinner({ apiUrl: origin });
    const got = await pinner.pin(PAYLOAD, cid, "application/json");
    expect(got).toBe(cid);
    expect(method).toBe("POST");
    expect(url).toContain("/api/v0/block/put");
    expect(url).toContain("cid-codec=raw");
    expect(url).toContain("mhtype=sha2-256");
    expect(url).toContain("pin=true");
    expect(contentType).toMatch(/^multipart\/form-data;/);
    expect(body.includes(Buffer.from(PAYLOAD))).toBe(true);
  });
});

describe("pinataPinner", () => {
  it("POSTs multipart pinFileToIPFS with cidVersion 1 and returns IpfsHash", async () => {
    const cid = await manifestCid(PAYLOAD);
    const pinataCid = (await unixfsFileBlock(PAYLOAD)).cid;
    let method = "";
    let url = "";
    let contentType = "";
    let authorization = "";
    let body: Buffer = Buffer.alloc(0);

    const { origin } = await listen(async (req, res) => {
      method = req.method ?? "";
      url = req.url ?? "";
      contentType = req.headers["content-type"] ?? "";
      authorization = req.headers.authorization ?? "";
      body = await readRequestBody(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ IpfsHash: pinataCid }));
    });

    const pinner = pinataPinner({ jwt: PINATA_JWT, fetch: rewriteFetch(origin) });
    const got = await pinner.pin(PAYLOAD, cid, "application/json");
    expect(got).toBe(pinataCid);
    expect(method).toBe("POST");
    expect(url).toBe("/pinning/pinFileToIPFS");
    expect(contentType).toMatch(/^multipart\/form-data;/);
    expect(authorization).toBe(`Bearer ${PINATA_JWT}`);
    expect(body.includes(Buffer.from(PAYLOAD))).toBe(true);
    expect(body.toString("utf8")).toContain('"cidVersion":1');
  });
});

describe("seedNodePinner", () => {
  it("POSTs raw bytes to /v1/pin and returns cid on 201", async () => {
    const cid = await manifestCid(PAYLOAD);
    let method = "";
    let url = "";
    let contentType = "";
    let body: Buffer = Buffer.alloc(0);

    const { origin } = await listen(async (req, res) => {
      method = req.method ?? "";
      url = req.url ?? "";
      contentType = req.headers["content-type"] ?? "";
      body = await readRequestBody(req);
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ cid }));
    });

    const pinner = seedNodePinner({ baseUrl: origin });
    const got = await pinner.pin(PAYLOAD, cid, "application/x-bittorrent");
    expect(got).toBe(cid);
    expect(method).toBe("POST");
    expect(url).toBe("/v1/pin");
    expect(contentType).toBe("application/x-bittorrent");
    expect(body.equals(Buffer.from(PAYLOAD))).toBe(true);
  });

  it("throws PUBLISH carrying { error, code } on 413", async () => {
    const cid = await manifestCid(PAYLOAD);
    const { origin } = await listen(async (req, res) => {
      await readRequestBody(req);
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "too large", code: "too_large" }));
    });
    const pinner = seedNodePinner({ baseUrl: origin });
    try {
      await pinner.pin(PAYLOAD, cid, "application/json");
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toMatchObject({ code: "PUBLISH" });
      const message = (err as EnspackError).message;
      expect(message).toContain("too large");
      expect(message).toContain("too_large");
    }
  });

  it("throws PUBLISH carrying { error, code } on 422", async () => {
    const cid = await manifestCid(PAYLOAD);
    const { origin } = await listen(async (req, res) => {
      await readRequestBody(req);
      res.writeHead(422, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid", code: "invalid_block" }));
    });
    const pinner = seedNodePinner({ baseUrl: origin });
    try {
      await pinner.pin(PAYLOAD, cid, "application/json");
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toMatchObject({ code: "PUBLISH" });
      const message = (err as EnspackError).message;
      expect(message).toContain("invalid");
      expect(message).toContain("invalid_block");
    }
  });
});

describe("createManifestStore.put with real adapters", () => {
  it("explains the Pinata CID mismatch after a successful pin", async () => {
    const localCid = await manifestCid(PAYLOAD);
    const pinataCid = (await unixfsFileBlock(PAYLOAD)).cid;
    const { origin } = await listen(async (req, res) => {
      await readRequestBody(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ IpfsHash: pinataCid }));
    });
    const store = createManifestStore({
      gateways: ["http://127.0.0.1/{cid}"],
      pinner: pinataPinner({ jwt: PINATA_JWT, fetch: rewriteFetch(origin) }),
    });
    try {
      await store.put(PAYLOAD);
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toMatchObject({ code: "PUBLISH" });
      const message = (err as EnspackError).message;
      expect(message).toContain(pinataCid);
      expect(message).toContain(localCid);
      expect(message).toContain("pin succeeded under a different CID");
      expect(message).toContain(`getVerified(${pinataCid})`);
      expect(message).toContain("returns identical bytes");
    }
  });
});
