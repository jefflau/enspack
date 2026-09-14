import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  INTERNAL_ONLY_HOST_PORTS,
  KEY_RE,
  TOKEN_RE,
  type ComposeService,
  envExampleKeys,
  interpolateCompose,
  interpolateVars,
  parseEnvExample,
  publishedHostPorts,
  readInfra,
} from "./helpers.js";

const SEVEN = [
  "bootstrap",
  "caddy",
  "indexer",
  "kubo",
  "qbittorrent",
  "registrar",
  "seed-api",
] as const;

const INTERNAL_ONLY = new Set<number>(INTERNAL_ONLY_HOST_PORTS);

describe("infra docker-compose.yml", () => {
  const raw = readInfra("docker-compose.yml");
  const envExample = readInfra(".env.example");
  const env = parseEnvExample(envExample);
  const interpolated = interpolateCompose(raw, env);
  const doc = parse(interpolated) as { services?: Record<string, ComposeService> };

  it("parses and has exactly the seven services", () => {
    expect(doc.services).toBeDefined();
    const names = Object.keys(doc.services ?? {}).sort();
    expect(names).toEqual([...SEVEN]);
  });

  it("publishes only caddy 80/443, qbittorrent 6881, kubo 4001", () => {
    const services = doc.services ?? {};
    expect([...new Set(publishedHostPorts(services.caddy))].sort()).toEqual([80, 443]);
    expect([...new Set(publishedHostPorts(services.qbittorrent))]).toEqual([6881]);
    expect([...new Set(publishedHostPorts(services.kubo))]).toEqual([4001]);
    expect(publishedHostPorts(services["seed-api"])).toEqual([]);
    expect(publishedHostPorts(services.registrar)).toEqual([]);
    expect(publishedHostPorts(services.indexer)).toEqual([]);
    expect(publishedHostPorts(services.bootstrap)).toEqual([]);

    for (const [name, svc] of Object.entries(services)) {
      for (const port of publishedHostPorts(svc)) {
        expect(INTERNAL_ONLY.has(port), `${name} published internal port ${port}`).toBe(false);
      }
    }
  });

  it("every service has restart and a healthcheck", () => {
    for (const name of SEVEN) {
      const svc = doc.services?.[name];
      expect(svc, name).toBeDefined();
      expect(svc?.restart, `${name} restart`).not.toBeUndefined();
      expect(svc?.healthcheck, `${name} healthcheck`).toBeDefined();
      expect(svc?.healthcheck?.test, `${name} healthcheck.test`).toBeDefined();
    }
  });

  it("bootstrap is a compose profile (not started by up -d)", () => {
    const profiles = doc.services?.bootstrap?.profiles;
    expect(profiles).toEqual(["bootstrap"]);
  });

  it("all ${VAR} references appear in .env.example", () => {
    const keys = envExampleKeys(envExample);
    for (const name of interpolateVars(raw)) {
      expect(keys.has(name), `${name} missing from .env.example`).toBe(true);
    }
  });

  it("seed-api and registrar healthcheck /v1/health; indexer uses Ponder /v1/health", () => {
    const dump = JSON.stringify(doc.services);
    expect(dump).toContain("/v1/health");
    expect(JSON.stringify(doc.services?.["seed-api"]?.healthcheck)).toContain("/v1/health");
    expect(JSON.stringify(doc.services?.registrar?.healthcheck)).toContain("/v1/health");
    expect(JSON.stringify(doc.services?.indexer?.healthcheck)).toMatch(/\/v1\/health|\/ready|\/health/);
  });
});

describe("Caddyfile", () => {
  it("proxies the three hosts from DOMAIN env", () => {
    const raw = readInfra("Caddyfile");
    expect(raw).toContain("seed1.{$DOMAIN}");
    expect(raw).toContain("registrar.{$DOMAIN}");
    expect(raw).toContain("index.{$DOMAIN}");
    expect(raw).toContain("reverse_proxy seed-api:8080");
    expect(raw).toContain("reverse_proxy registrar:8080");
    expect(raw).toContain("reverse_proxy indexer:42069");
    expect(raw).toContain("email {$ACME_EMAIL}");
  });
});

describe("no baked secrets", () => {
  it("compose and Caddyfile contain no 0x+64-hex key or token", () => {
    const compose = readInfra("docker-compose.yml");
    const caddy = readInfra("Caddyfile");
    expect(compose).not.toMatch(KEY_RE);
    expect(caddy).not.toMatch(KEY_RE);
    expect(compose).not.toMatch(TOKEN_RE);
    expect(caddy).not.toMatch(TOKEN_RE);
  });
});
