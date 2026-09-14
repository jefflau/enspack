import { EnspackError } from "@enspack/core";
import { describe, expect, it } from "vitest";
import { checkAllowRoots, checkLicense, checkQuota } from "../src/policy.js";

describe("policy", () => {
  it("checkAllowRoots accepts publisher equal to a root or ending with .<root>", () => {
    checkAllowRoots("enspack.eth", ["enspack.eth"]);
    checkAllowRoots("mirrors.enspack.eth", ["enspack.eth"]);
    expect(() => checkAllowRoots("other.eth", ["enspack.eth"])).toThrow(EnspackError);
    expect(() => checkAllowRoots("xenspack.eth", ["enspack.eth"])).toThrow(/outside allowRoots/);
  });

  it("checkLicense is case-insensitive against the allowlist", () => {
    checkLicense("Apache-2.0", ["apache-2.0"]);
    expect(() => checkLicense("gpl-3.0", ["apache-2.0"])).toThrow(EnspackError);
  });

  it("checkQuota names the publisher when exceeded", () => {
    checkQuota("mirrors.enspack.eth", 10, 10, 20);
    expect(() => checkQuota("mirrors.enspack.eth", 10, 11, 20)).toThrow(/mirrors\.enspack\.eth/);
  });
});
