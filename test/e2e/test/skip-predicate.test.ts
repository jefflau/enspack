import { describe, expect, it } from "vitest";
import { shouldSkipSepolia } from "./helpers/skip.js";

describe("sepolia skip predicate", () => {
  it("is true when env is empty (suite self-skips without secrets)", () => {
    expect(shouldSkipSepolia({})).toBe(true);
    expect(shouldSkipSepolia({ SEPOLIA_RPC_URL: "", ENSPACK_PUBLISHER_KEY: "" })).toBe(true);
  });

  it("is false when both secrets are set", () => {
    expect(
      shouldSkipSepolia({
        SEPOLIA_RPC_URL: "https://example.invalid",
        ENSPACK_PUBLISHER_KEY: `0x${"ab".repeat(32)}`,
      }),
    ).toBe(false);
  });
});
