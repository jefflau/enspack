import { EnspackError } from "@enspack/core";
import { describe, expect, it } from "vitest";
import { HfClient } from "../src/index.js";

describe("licenseGate", () => {
  const client = new HfClient({ fetch: async () => new Response("unused") });

  it("allows apache-2.0", () => {
    expect(client.licenseGate("apache-2.0")).toBeUndefined();
  });

  it("throws POLICY when license is null", () => {
    try {
      client.licenseGate(null);
      expect.unreachable("expected POLICY");
    } catch (err) {
      expect(err).toBeInstanceOf(EnspackError);
      expect((err as EnspackError).code).toBe("POLICY");
    }
  });

  it("throws POLICY for llama3.1", () => {
    try {
      client.licenseGate("llama3.1");
      expect.unreachable("expected POLICY");
    } catch (err) {
      expect(err).toBeInstanceOf(EnspackError);
      expect((err as EnspackError).code).toBe("POLICY");
    }
  });

  it("passes llama3.1 when override is true", () => {
    expect(client.licenseGate("llama3.1", { override: true })).toBeUndefined();
  });
});
