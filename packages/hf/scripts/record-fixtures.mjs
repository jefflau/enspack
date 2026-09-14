#!/usr/bin/env node
/**
 * Record live HF + Hugging Bay responses for packages/hf tests.
 * Network is allowed here; unit tests must replay the written fixtures.
 *
 * Usage: node packages/hf/scripts/record-fixtures.mjs
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "test/fixtures");
const REPO = "Qwen/Qwen2.5-7B-Instruct";
const REVISION = "a09a35458c702b33eeacc393d103063234e8bc28";
const HF = "https://huggingface.co";
const HB = "https://huggingbay.xyz";
const HB_URI = `hb://${REPO}@sha256:d82247b7101aea36fd25bc61273bc1d2627d2cc0cb0fd29cb9586044f4e999fd`;

const token = process.env.HF_TOKEN;
const headers = {
  accept: "application/json",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

function parseLinkNext(header) {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel\s*=\s*"?next"?/i.exec(part);
    if (match?.[1]) return match[1];
  }
  return null;
}

async function get(url, init = {}) {
  const merged = { ...headers, ...init.headers };
  const res = await fetch(url, { ...init, headers: merged });
  const buf = Buffer.from(await res.arrayBuffer());
  return { res, buf, status: res.status };
}

async function download(url) {
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const buf = Buffer.from(await res.arrayBuffer());
  return { res, buf };
}

async function writeJson(rel, value) {
  const path = join(FIXTURES, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

async function writeBin(rel, buf) {
  const path = join(FIXTURES, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buf);
  return path;
}

const observed = [];

{
  const { res, buf } = await get(`${HF}/api/models/${REPO}`);
  observed.push(`HF info ${res.status} ${buf.length}B`);
  await writeJson("hf/info.json", JSON.parse(buf.toString("utf8")));
}

{
  const { res, buf } = await get(`${HF}/api/models/${REPO}/revision/${REVISION}`);
  observed.push(`HF revision ${res.status} ${buf.length}B`);
  await writeJson("hf/revision.json", JSON.parse(buf.toString("utf8")));
}

{
  const pages = [];
  let url = `${HF}/api/models/${REPO}/tree/${REVISION}?recursive=true`;
  while (url) {
    const { res, buf } = await get(url);
    observed.push(
      `HF tree page ${pages.length} ${res.status} ${buf.length}B Link=${res.headers.get("Link") ?? ""}`,
    );
    const body = JSON.parse(buf.toString("utf8"));
    pages.push(body);
    await writeJson(`hf/tree-page-${pages.length}.json`, body);
    const next = parseLinkNext(res.headers.get("Link"));
    url = next ? new URL(next, url).href : null;
  }
  const tree = pages.flat();
  await writeJson("hf/tree.json", tree);

  const filesDir = join(FIXTURES, "hf/files");
  await mkdir(filesDir, { recursive: true });
  const hashes = [];
  for (const entry of tree) {
    if (entry.type && entry.type !== "file") continue;
    if (entry.lfs) {
      hashes.push({
        path: entry.path,
        source: "lfs",
        size: entry.lfs.size,
        sha256: entry.lfs.oid,
      });
      continue;
    }
    const url = `${HF}/${REPO}/resolve/${REVISION}/${entry.path}`;
    const { res, buf } = await download(url);
    if (!res.ok) throw new Error(`download ${entry.path} HTTP ${res.status}`);
    await writeBin(`hf/files/${entry.path}`, buf);
    const sha256 = createHash("sha256").update(buf).digest("hex");
    hashes.push({ path: entry.path, source: "download", size: buf.length, sha256 });
    observed.push(`HF file ${entry.path} ${buf.length}B sha256=${sha256}`);
  }
  await writeJson("hf/file-hashes.json", hashes);
}

{
  const probes = [
    [
      "hb/resolve-hb-no-digest.json",
      `${HB}/api/resolve/hb?uri=${encodeURIComponent(`hb://${REPO}`)}`,
    ],
    ["hb/resolve-hb.json", `${HB}/api/resolve/hb?uri=${encodeURIComponent(HB_URI)}`],
    ["hb/resolve-repo.json", `${HB}/api/resolve?repo=${encodeURIComponent(REPO)}`],
    ["hb/lock.json", `${HB}/api/artifacts/hf-model-qwen-qwen2-5-7b-instruct/lock`],
    [
      "hb/decentralized-fallbacks-get.json",
      `${HB}/api/artifacts/hf-model-qwen-qwen2-5-7b-instruct/decentralized-fallbacks`,
    ],
  ];
  for (const [rel, url] of probes) {
    const { res, buf } = await get(url);
    let body;
    try {
      body = JSON.parse(buf.toString("utf8"));
    } catch {
      body = { _status: res.status, _text: buf.toString("utf8").slice(0, 2000) };
    }
    await writeJson(rel, { _status: res.status, ...body });
    observed.push(`HB ${rel} HTTP ${res.status} ${buf.length}B`);
  }

  const postUrl = `${HB}/api/artifacts/hf-model-qwen-qwen2-5-7b-instruct/decentralized-fallbacks`;
  const { res, buf } = await get(postUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      magnet: "magnet:?xt=urn:btih:0000000000000000000000000000000000000000",
      displayName: "enspack-fixture-probe",
      infohash: "0000000000000000000000000000000000000000",
    }),
  });
  let body;
  try {
    body = JSON.parse(buf.toString("utf8"));
  } catch {
    body = { _text: buf.toString("utf8").slice(0, 2000) };
  }
  await writeJson("hb/decentralized-fallbacks-post.json", { _status: res.status, ...body });
  observed.push(`HB fallback POST HTTP ${res.status}`);
}

await writeJson("observed.json", {
  recordedAt: new Date().toISOString(),
  repo: REPO,
  revision: REVISION,
  observed,
});
console.error(observed.join("\n"));
