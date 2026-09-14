import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@enspack/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "@enspack/hf": fileURLToPath(new URL("../../packages/hf/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    fileParallelism: false,
    // PGlite cold-starts a Postgres WASM instance per test; CI runners under
    // load can take well over vitest's 5 s default for the first one.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
