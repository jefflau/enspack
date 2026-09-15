import { CID } from "multiformats/cid";
import { describe, expect, it } from "vitest";
import { EnspackError, createManifestStore, manifestCid } from "../../src/index.js";
import type { Pinner } from "../../src/index.js";
import {
  delay,
  gatewayTemplate,
  listen,
  unixfsDirectoryBlock,
  unixfsFileBlock,
} from "./helpers.js";

const PAYLOAD = new TextEncoder().encode("enspack-ipfs-block");
const TAMPERED = new TextEncoder().encode("tampered-not-the-cid-bytes!!");

async function serveBytes(
  body: Uint8Array,
  status = 200,
  headers: Record<string, string> = {},
): Promise<string> {
  const { origin } = await listen((_req, res) => {
    res.writeHead(status, headers);
    res.end(Buffer.from(body));
  });
  return origin;
}

describe("createManifestStore.getVerified", () => {
  it("rejects a tampered gateway and returns bytes from the next one", async () => {
    const cid = await manifestCid(PAYLOAD);
    const bad = await serveBytes(TAMPERED);
    const good = await serveBytes(PAYLOAD);
    const store = createManifestStore({
      gateways: [gatewayTemplate(bad), gatewayTemplate(good)],
      timeoutMs: 2000,
    });
    const got = await store.getVerified(cid);
    expect(got).toEqual(PAYLOAD);
  });

  it("lists every gateway when all responses are tampered", async () => {
    const cid = await manifestCid(PAYLOAD);
    const a = await serveBytes(TAMPERED);
    const b = await serveBytes(new TextEncoder().encode("also-wrong"));
    const store = createManifestStore({
      gateways: [gatewayTemplate(a), gatewayTemplate(b)],
      timeoutMs: 2000,
    });
    try {
      await store.getVerified(cid);
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(EnspackError);
      expect(err).toMatchObject({ code: "FETCH" });
      const message = (err as EnspackError).message;
      expect(message).toContain("all gateways failed");
      expect(message).toContain(a);
      expect(message).toContain(b);
      expect(message).toContain("bytes do not hash to CID");
      expect(message).not.toContain("tampered-not-the-cid-bytes");
      expect(message).not.toContain("also-wrong");
    }
  });

  it("rotates on HTTP 429 like other gateway failures", async () => {
    const cid = await manifestCid(PAYLOAD);
    const { origin: limited } = await listen((_req, res) => {
      res.writeHead(429, { "content-type": "text/plain" });
      res.end("rate-limit-body-must-not-leak");
    });
    const good = await serveBytes(PAYLOAD);
    const store = createManifestStore({
      gateways: [gatewayTemplate(limited), gatewayTemplate(good)],
      timeoutMs: 2000,
    });
    const got = await store.getVerified(cid);
    expect(got).toEqual(PAYLOAD);

    const only429 = createManifestStore({
      gateways: [gatewayTemplate(limited)],
      timeoutMs: 2000,
    });
    try {
      await only429.getVerified(cid);
      expect.unreachable("should throw");
    } catch (err) {
      const message = (err as EnspackError).message;
      expect(err).toMatchObject({ code: "FETCH" });
      expect(message).toContain("HTTP 429");
      expect(message).not.toContain("rate-limit-body-must-not-leak");
    }
  });

  it("rotates on HTTP 500 without including the response body", async () => {
    const cid = await manifestCid(PAYLOAD);
    const { origin: bad } = await listen((_req, res) => {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("internal-secret-should-never-leak");
    });
    const good = await serveBytes(PAYLOAD);
    const store = createManifestStore({
      gateways: [gatewayTemplate(bad), gatewayTemplate(good)],
      timeoutMs: 2000,
    });
    const got = await store.getVerified(cid);
    expect(got).toEqual(PAYLOAD);

    const allFail = createManifestStore({
      gateways: [gatewayTemplate(bad)],
      timeoutMs: 2000,
    });
    try {
      await allFail.getVerified(cid);
      expect.unreachable("should throw");
    } catch (err) {
      const message = (err as EnspackError).message;
      expect(err).toMatchObject({ code: "FETCH" });
      expect(message).toContain("HTTP 500");
      expect(message).not.toContain("internal-secret-should-never-leak");
    }
  });

  it("rotates on timeout when the server never responds", async () => {
    const cid = await manifestCid(PAYLOAD);
    const { origin: hanging } = await listen(() => {
      /* never respond */
    });
    const good = await serveBytes(PAYLOAD);
    const store = createManifestStore({
      gateways: [gatewayTemplate(hanging), gatewayTemplate(good)],
      timeoutMs: 80,
    });
    const got = await store.getVerified(cid);
    expect(got).toEqual(PAYLOAD);

    const onlyHang = createManifestStore({
      gateways: [gatewayTemplate(hanging)],
      timeoutMs: 80,
    });
    try {
      await onlyHang.getVerified(cid);
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toMatchObject({ code: "FETCH" });
      expect((err as EnspackError).message).toMatch(/timeout after 80ms/);
    }
  });

  it("rotates on connection refused", async () => {
    const cid = await manifestCid(PAYLOAD);
    // A freed ephemeral port can be reused by a parallel test, so the refused
    // gateway is simulated with the exact error shape undici produces.
    const refusedOrigin = "http://127.0.0.1:9";
    const refusingFetch: typeof fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith(refusedOrigin)) {
        const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9"), {
          code: "ECONNREFUSED",
        });
        return Promise.reject(new TypeError("fetch failed", { cause }));
      }
      return fetch(input, init);
    };
    const good = await serveBytes(PAYLOAD);
    const store = createManifestStore({
      gateways: [gatewayTemplate(refusedOrigin), gatewayTemplate(good)],
      timeoutMs: 2000,
      fetch: refusingFetch,
    });
    const got = await store.getVerified(cid);
    expect(got).toEqual(PAYLOAD);

    const onlyRefused = createManifestStore({
      gateways: [gatewayTemplate(refusedOrigin)],
      timeoutMs: 2000,
      fetch: refusingFetch,
    });
    try {
      await onlyRefused.getVerified(cid);
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toMatchObject({ code: "FETCH" });
      expect((err as EnspackError).message).toContain("connection refused");
    }
  });

  it("rejects over-cap responses with FETCH before the body finishes even if the hash would match", async () => {
    const payload = new Uint8Array(64 * 1024);
    payload.fill(7);
    const cid = await manifestCid(payload);
    const cap = 4096;
    let bytesWritten = 0;
    let finished = false;

    const { origin } = await listen((req, res) => {
      res.writeHead(200, { "content-type": "application/vnd.ipld.raw" });
      let offset = 0;
      const timer = setInterval(() => {
        if (req.destroyed || res.destroyed) {
          clearInterval(timer);
          return;
        }
        const next = payload.subarray(offset, offset + 1024);
        if (next.byteLength === 0) {
          finished = true;
          clearInterval(timer);
          res.end();
          return;
        }
        res.write(next);
        offset += next.byteLength;
        bytesWritten = offset;
      }, 5);
      req.on("close", () => {
        clearInterval(timer);
      });
    });

    const store = createManifestStore({
      gateways: [gatewayTemplate(origin)],
      timeoutMs: 5000,
      maxBytes: cap,
    });

    const started = Date.now();
    try {
      await store.getVerified(cid);
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toMatchObject({ code: "FETCH" });
      expect((err as EnspackError).message).toMatch(/exceeds cap/);
    }
    const elapsed = Date.now() - started;
    expect(finished).toBe(false);
    expect(bytesWritten).toBeLessThan(payload.byteLength);
    expect(elapsed).toBeLessThan(4000);
    await delay(30);
  });

  it("returns UnixFS file data for a dag-pb leaf whose CID is bafybei…", async () => {
    const fileData = new TextEncoder().encode("hello from unixfs");
    const leaf = await unixfsFileBlock(fileData);
    expect(leaf.cid.startsWith("bafybei")).toBe(true);
    const origin = await serveBytes(leaf.bytes);
    const store = createManifestStore({
      gateways: [gatewayTemplate(origin)],
      timeoutMs: 2000,
    });
    const got = await store.getVerified(leaf.cid);
    expect(got).toEqual(fileData);
  });

  it("rejects a dag-pb root with links with FETCH", async () => {
    const fileData = new TextEncoder().encode("child");
    const leaf = await unixfsFileBlock(fileData);
    const dir = await unixfsDirectoryBlock(CID.parse(leaf.cid), leaf.bytes.byteLength);
    expect(dir.cid.startsWith("bafybei")).toBe(true);
    const origin = await serveBytes(dir.bytes);
    const store = createManifestStore({
      gateways: [gatewayTemplate(origin)],
      timeoutMs: 2000,
    });
    try {
      await store.getVerified(dir.cid);
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toMatchObject({ code: "FETCH" });
      expect((err as EnspackError).message).toMatch(/links/i);
    }
  });

  it("sends Accept: application/vnd.ipld.raw and format=raw", async () => {
    const cid = await manifestCid(PAYLOAD);
    let accept: string | undefined;
    let urlPath = "";
    const { origin } = await listen((req, res) => {
      accept = req.headers.accept;
      urlPath = req.url ?? "";
      res.writeHead(200);
      res.end(Buffer.from(PAYLOAD));
    });
    const store = createManifestStore({
      gateways: [gatewayTemplate(origin)],
      timeoutMs: 2000,
    });
    await store.getVerified(cid);
    expect(accept).toBe("application/vnd.ipld.raw");
    expect(urlPath).toContain("format=raw");
    expect(urlPath).toContain(cid);
  });
});

describe("createManifestStore.put", () => {
  it("succeeds when the pinner returns the local manifestCid", async () => {
    const pinner: Pinner = {
      name: "fake",
      async pin(_bytes, cid) {
        return cid;
      },
    };
    const store = createManifestStore({
      gateways: ["http://127.0.0.1/{cid}"],
      pinner,
    });
    const cid = await store.put(PAYLOAD);
    expect(cid).toBe(await manifestCid(PAYLOAD));
  });

  it("throws PUBLISH when the pinner CID differs from the local CID", async () => {
    const other = await manifestCid(TAMPERED);
    const pinner: Pinner = {
      name: "fake",
      async pin() {
        return other;
      },
    };
    const store = createManifestStore({
      gateways: ["http://127.0.0.1/{cid}"],
      pinner,
    });
    const local = await manifestCid(PAYLOAD);
    try {
      await store.put(PAYLOAD);
      expect.unreachable("should throw");
    } catch (err) {
      expect(err).toMatchObject({ code: "PUBLISH" });
      const message = (err as EnspackError).message;
      expect(message).toContain(other);
      expect(message).toContain(local);
      expect(message).toContain("pin succeeded under a different CID");
      expect(message).toContain(`getVerified(${other})`);
    }
  });

  it("throws PUBLISH when no pinner is configured", async () => {
    const store = createManifestStore({ gateways: ["http://127.0.0.1/{cid}"] });
    await expect(store.put(PAYLOAD)).rejects.toMatchObject({
      code: "PUBLISH",
      message: "no pinner configured",
    });
  });
});
