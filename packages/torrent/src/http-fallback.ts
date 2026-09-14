import { EnspackError } from "@enspack/core";
import type { Manifest } from "@enspack/core";

/**
 * SPEC §4 step 7c: `webseed + path` URLs for every webseed. Used by `--http-only`
 * and by WP-08 for messaging.
 */
export function httpFallbackSources(manifest: Manifest, path: string): string[] {
  if (path.startsWith("/") || path.split("/").includes("..")) {
    throw new EnspackError("VERIFY", `refusing path "${path}"`);
  }
  return manifest.distribution.webseeds.map((ws) => `${ws}${path}`);
}
