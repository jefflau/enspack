import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// VITE_BASE lets the same bundle serve from a sub-path (GitHub Pages: "/enspack/") or the root.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
  build: { target: "es2022", sourcemap: true },
});
