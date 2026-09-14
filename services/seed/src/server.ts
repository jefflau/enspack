import { createManifestStore, createResolver, kuboPinner } from "@enspack/core";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadSeedEnv, rpcUrlFor } from "./env.js";
import { createKuboClient } from "./kubo.js";
import { createQbittorrentClient } from "./qbittorrent.js";

function kuboGatewayTemplate(apiUrl: string): string {
  try {
    const url = new URL(apiUrl);
    if (url.port === "5001") {
      url.port = "8080";
    }
    url.pathname = "/ipfs/{cid}";
    url.search = "";
    return url.href;
  } catch {
    return "http://kubo:8080/ipfs/{cid}";
  }
}

const env = loadSeedEnv();
const rpcUrl = rpcUrlFor(env);
const pinner = kuboPinner({ apiUrl: env.kuboApi });
const store = createManifestStore({
  gateways: [kuboGatewayTemplate(env.kuboApi)],
  pinner,
});
const resolver = createResolver({
  chain: env.chain,
  rpcUrl,
  store,
});
const qbt = createQbittorrentClient({
  baseUrl: env.qbtUrl,
  username: env.qbtUser,
  password: env.qbtPass,
});
const kubo = createKuboClient({ apiUrl: env.kuboApi });

const app = createApp({
  resolver,
  store,
  qbt,
  kubo,
  pinner,
  allowRoots: env.allowRoots,
  licenseAllowlist: env.licenseAllowlist,
  quotaBytesPerPublisher: env.quotaBytesPerPublisher,
  downloadDir: env.downloadDir,
  chain: env.chain,
});

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.error(JSON.stringify({ ts: new Date().toISOString(), msg: "listen", port: info.port }));
});
