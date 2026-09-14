import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@enspack/core": fileURLToPath(new URL("../packages/core/src/index.ts", import.meta.url)),
      "@enspack/hf": fileURLToPath(new URL("../packages/hf/src/index.ts", import.meta.url)),
      "@enspack/torrent": fileURLToPath(new URL("../packages/torrent/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
