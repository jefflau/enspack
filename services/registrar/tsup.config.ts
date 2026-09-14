import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/server.ts"],
  format: ["esm"],
  dts: { entry: { index: "src/index.ts" } },
  sourcemap: true,
  clean: true,
  target: "node22",
  platform: "node",
  splitting: false,
  skipNodeModulesBundle: true,
});
