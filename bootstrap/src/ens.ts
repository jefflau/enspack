import type { EnsV2Config, EnsVersion, EnspackChainName } from "@enspack/core";
import { ensV2ConfigFor, ensVersionFor } from "@enspack/core";

/** WP-17: `ensVersion` + optional `ensV2` for `createResolver` / `createPublisher`. */
export function ensOptsFor(
  chain: EnspackChainName,
  env: NodeJS.ProcessEnv,
): { ensVersion: EnsVersion; ensV2?: EnsV2Config } {
  const ensVersion = ensVersionFor(chain, env);
  if (ensVersion === "v2") {
    return { ensVersion, ensV2: ensV2ConfigFor(chain, env) };
  }
  return { ensVersion };
}
