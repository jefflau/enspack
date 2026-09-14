import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { readInfra } from "./helpers.js";

describe("infra/nightly-health.yml", () => {
  it("parses as a GitHub workflow that skips without INFRA_BASE_DOMAIN", () => {
    const raw = readInfra("nightly-health.yml");
    const doc = parse(raw) as {
      on?: { schedule?: unknown };
      jobs?: Record<string, { steps?: Array<{ env?: Record<string, string>; run?: string }> }>;
    };
    expect(doc.on?.schedule).toBeDefined();
    expect(raw).toContain("secrets.INFRA_BASE_DOMAIN");
    const health = doc.jobs?.health;
    expect(health).toBeDefined();
    const run = health?.steps?.map((s) => s.run ?? "").join("\n") ?? "";
    expect(run).toMatch(/INFRA_BASE_DOMAIN secret absent; skipping/);
    expect(run).toContain("seed1.${INFRA_BASE_DOMAIN}/v1/health");
    expect(run).toContain("registrar.${INFRA_BASE_DOMAIN}/v1/health");
    expect(run).toContain("index.${INFRA_BASE_DOMAIN}/v1/health");
  });
});
