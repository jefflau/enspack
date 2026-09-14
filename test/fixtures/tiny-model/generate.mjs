#!/usr/bin/env node
// Regenerates this folder's binary + torrent + manifest.
// From packages/torrent: `pnpm generate-fixture`
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const torrentPkg = join(dirname(fileURLToPath(import.meta.url)), "../../../packages/torrent");
const r = spawnSync("pnpm", ["generate-fixture"], { cwd: torrentPkg, stdio: "inherit" });
process.exit(r.status === 0 ? 0 : 1);
