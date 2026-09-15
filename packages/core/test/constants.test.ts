import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GATEWAYS,
  PINATA_GATEWAY,
  SELF_CID_PLACEHOLDER,
  gatewaysFromEnv,
  validateManifest,
} from "../src/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("SELF_CID_PLACEHOLDER (issue #30)", () => {
  it("is bafkrei plus 52 a's and matches the tiny-model fixture", () => {
    expect(SELF_CID_PLACEHOLDER).toBe(`bafkrei${"a".repeat(52)}`);
    const fixture = JSON.parse(
      readFileSync(join(repoRoot, "test/fixtures/tiny-model.enspack.json"), "utf8"),
    ) as { versions: { cid: string }[] };
    expect(fixture.versions[fixture.versions.length - 1]?.cid).toBe(SELF_CID_PLACEHOLDER);
    expect(validateManifest(fixture).versions.at(-1)?.cid).toBe(SELF_CID_PLACEHOLDER);
  });
});

describe("gatewaysFromEnv (WP-22)", () => {
  it("leaves DEFAULT_GATEWAYS as the SPEC §4 step 3 list", () => {
    expect([...DEFAULT_GATEWAYS]).toEqual([
      "https://{cid}.ipfs.dweb.link",
      "https://ipfs.io/ipfs/{cid}",
      "https://{cid}.ipfs.w3s.link",
    ]);
  });

  it("prepends Pinata then SPEC defaults, with ENSPACK_IPFS_GATEWAYS first", () => {
    expect(gatewaysFromEnv({})).toEqual([PINATA_GATEWAY, ...DEFAULT_GATEWAYS]);
    expect(
      gatewaysFromEnv({
        ENSPACK_IPFS_GATEWAYS: "https://a.example/{cid}, https://b.example/{cid}",
      }),
    ).toEqual([
      "https://a.example/{cid}",
      "https://b.example/{cid}",
      PINATA_GATEWAY,
      ...DEFAULT_GATEWAYS,
    ]);
    expect(gatewaysFromEnv({ ENSPACK_IPFS_GATEWAYS: "  " })).toEqual([
      PINATA_GATEWAY,
      ...DEFAULT_GATEWAYS,
    ]);
  });
});
