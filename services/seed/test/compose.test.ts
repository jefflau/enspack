import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function publishedPorts(service: unknown): string[] {
  if (typeof service !== "object" || service === null) return [];
  const ports = (service as { ports?: unknown }).ports;
  if (!Array.isArray(ports)) return [];
  return ports.map((p) => String(p));
}

describe("compose / Dockerfile structure", () => {
  it("parses docker-compose.yml: three services, Kubo API not on host, no baked secrets", () => {
    const raw = readFileSync(join(pkgRoot, "docker-compose.yml"), "utf8");
    const doc = parse(raw) as { services?: Record<string, unknown> };
    expect(doc.services).toBeDefined();
    const names = Object.keys(doc.services ?? {}).sort();
    expect(names).toEqual(["api", "kubo", "qbittorrent"]);

    const kuboPorts = publishedPorts(doc.services?.kubo);
    expect(kuboPorts.join(" ")).not.toMatch(/\b5001\b/);

    expect(raw).not.toMatch(/(?:QBT_PASS|PASSWORD|JWT|PRIVATE_KEY|SECRET)\s*:\s*['"]?[^$\s'"]+/i);
    expect(raw).not.toMatch(/0x[0-9a-fA-F]{64}/);
    expect(raw).not.toContain("adminadmin");
  });

  it("Dockerfile is node:22-alpine multi-stage and uses pnpm deploy --filter @enspack/seed --prod", () => {
    const raw = readFileSync(join(pkgRoot, "Dockerfile"), "utf8");
    const fromCount = [...raw.matchAll(/^FROM /gm)].length;
    expect(fromCount).toBeGreaterThanOrEqual(2);
    expect(raw).toContain("node:22-alpine");
    expect(raw).toContain("pnpm deploy --filter @enspack/seed --prod");
  });
});
