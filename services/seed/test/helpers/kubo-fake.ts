import { manifestCid } from "@enspack/core";
import { formPart, listen, readRequestBody } from "./http.js";

export interface FakeKuboRequest {
  method: string;
  url: string;
  body: Buffer;
}

export interface FakeKubo {
  origin: string;
  requests: FakeKuboRequest[];
  putCids: string[];
  overrideCid: string | null;
  failId: boolean;
}

/**
 * Kubo HTTP API stand-in on 127.0.0.1 (block/put returns the raw sha2-256 CID of the file part).
 */
export async function startFakeKubo(): Promise<FakeKubo> {
  const fake: FakeKubo = {
    origin: "",
    requests: [],
    putCids: [],
    overrideCid: null,
    failId: false,
  };

  const { origin } = await listen(async (req, res) => {
    const url = req.url ?? "";
    const body = await readRequestBody(req);
    fake.requests.push({ method: req.method ?? "", url, body });

    if (url.startsWith("/api/v0/id")) {
      if (fake.failId) {
        res.writeHead(500);
        res.end("down");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ID: "fake" }));
      return;
    }

    if (url.includes("/api/v0/block/put")) {
      const file = formPart(body, "file") ?? body;
      const cid = fake.overrideCid ?? (await manifestCid(new Uint8Array(file)));
      fake.putCids.push(cid);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ Key: cid, Size: file.byteLength }));
      return;
    }

    res.writeHead(404);
    res.end("unknown");
  });

  fake.origin = origin;
  return fake;
}
