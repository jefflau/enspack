import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bootstrapStatePath } from "../src/cli.js";

describe("bootstrapStatePath", () => {
  it("defaults to <package>/state.json", () => {
    expect(bootstrapStatePath({}, "/app")).toBe(join("/app", "state.json"));
    expect(bootstrapStatePath({ ENSPACK_BOOTSTRAP_STATE: "" }, "/app")).toBe(
      join("/app", "state.json"),
    );
  });

  it("honors ENSPACK_BOOTSTRAP_STATE", () => {
    expect(bootstrapStatePath({ ENSPACK_BOOTSTRAP_STATE: "/data/state.json" }, "/app")).toBe(
      "/data/state.json",
    );
  });
});
