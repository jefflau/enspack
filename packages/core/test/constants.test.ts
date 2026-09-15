import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SELF_CID_PLACEHOLDER, validateManifest } from "../src/index.js";

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
