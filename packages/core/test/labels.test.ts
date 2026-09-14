import fc from "fast-check";
import { normalize } from "viem/ens";
import { describe, expect, it } from "vitest";
import {
  EnspackError,
  isVersionLabel,
  labelhashOf,
  mirrorLabel,
  namehashOf,
  normalizeLabel,
  parseRef,
  versionLabel,
} from "../src/index.js";

describe("normalizeLabel", () => {
  it("is idempotent", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 64 }), (s) => {
        const once = normalizeLabel(s);
        expect(normalizeLabel(once)).toBe(once);
      }),
      { numRuns: 100 },
    );
  });

  it("output passes viem/ens normalize() unchanged or is empty", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 63 }), (s) => {
        const out = normalizeLabel(s);
        if (out === "") {
          return;
        }
        expect(normalize(out)).toBe(out);
      }),
      { numRuns: 100 },
    );
  });

  it("only [a-z0-9-], no leading/trailing -, no -- runs inside a single label", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 64 }), (s) => {
        const out = normalizeLabel(s);
        expect(out).toMatch(/^(?:|[a-z0-9]+(?:-[a-z0-9]+)*)$/);
      }),
      { numRuns: 100 },
    );
  });

  it("matches SPEC §1.2 examples", () => {
    expect(normalizeLabel("Qwen2.5-7B-Instruct")).toBe("qwen2-5-7b-instruct");
    expect(normalizeLabel("Q4_K_M")).toBe("q4-k-m");
    expect(normalizeLabel("DeepSeek-R1-Distill-Qwen-7B")).toBe("deepseek-r1-distill-qwen-7b");
  });
});

describe("mirrorLabel", () => {
  it('mirrorLabel("Qwen","Qwen2.5-7B-Instruct") === "qwen--qwen2-5-7b-instruct"', () => {
    expect(mirrorLabel("Qwen", "Qwen2.5-7B-Instruct")).toBe("qwen--qwen2-5-7b-instruct");
  });

  it('mirrorLabel("a-", "-b") === "a--b" (collapse is per part, never across the join)', () => {
    expect(mirrorLabel("a-", "-b")).toBe("a--b");
  });
});

describe("versionLabel", () => {
  it('versionLabel("1.0.0-rc.1") === "v1-0-0-rc-1"', () => {
    expect(versionLabel("1.0.0-rc.1")).toBe("v1-0-0-rc-1");
  });

  it('versionLabel("1.0.0") === "v1-0-0"', () => {
    expect(versionLabel("1.0.0")).toBe("v1-0-0");
  });

  it("isVersionLabel accepts version labels and rejects model labels", () => {
    expect(isVersionLabel("v1-0-0")).toBe(true);
    expect(isVersionLabel("v1-0-0-rc-1")).toBe(true);
    expect(isVersionLabel("qwen2-5-7b-instruct")).toBe(false);
  });
});

describe("parseRef", () => {
  it('parseRef("m.pub.enspack.eth@1.0.0") → version name', () => {
    expect(parseRef("m.pub.enspack.eth@1.0.0")).toEqual({
      name: "v1-0-0.m.pub.enspack.eth",
      version: "1.0.0",
    });
  });

  it('parseRef("m.pub.enspack.eth") → model name', () => {
    expect(parseRef("m.pub.enspack.eth")).toEqual({ name: "m.pub.enspack.eth" });
  });

  it('parseRef("Qwen.enspack.eth") throws RESOLVE (normalization changes it)', () => {
    expect(() => parseRef("Qwen.enspack.eth")).toThrow(EnspackError);
    try {
      parseRef("Qwen.enspack.eth");
    } catch (e) {
      expect(e).toBeInstanceOf(EnspackError);
      expect(e).toMatchObject({ code: "RESOLVE" });
    }
  });

  it("throws RESOLVE on empty names and fewer than 2 labels", () => {
    expect(() => parseRef("")).toThrow(EnspackError);
    expect(() => parseRef("lonely")).toThrow(EnspackError);
    try {
      parseRef("lonely");
    } catch (e) {
      expect(e).toMatchObject({ code: "RESOLVE" });
    }
  });
});

describe("namehashOf / labelhashOf", () => {
  it("returns 0x-hex", () => {
    expect(namehashOf("enspack.eth")).toMatch(/^0x[0-9a-f]{64}$/);
    expect(labelhashOf("enspack")).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
