import {
  type EnsV2Config,
  type EnsVersion,
  type EnspackChainName,
  EnspackError,
  type PublishCall,
  type PublishResult,
  type PublishResultV2,
  ensV2ConfigFor,
  ensVersionFor,
} from "@enspack/core";

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

/** WP-17: `--ens-version v1|v2` wins over `ENSPACK_ENS_VERSION` by writing into `env`. */
export function applyEnsVersionFlag(env: NodeJS.ProcessEnv, value: string | undefined): void {
  if (value === undefined || value === "") {
    return;
  }
  if (value !== "v1" && value !== "v2") {
    throw new EnspackError("RESOLVE", "--ens-version must be v1 or v2");
  }
  env.ENSPACK_ENS_VERSION = value;
}

/** WP-15 `PublishResultV2.setup`; v1 results have no field. */
export function setupCalls(result: PublishResult): PublishCall[] {
  if ("setup" in result && Array.isArray((result as PublishResultV2).setup)) {
    return (result as PublishResultV2).setup;
  }
  return [];
}

function callKey(call: PublishCall): string {
  return `${call.to}:${call.data}:${call.description}`;
}

/** Union `calls` with extra `setup` entries so plan gas includes first-time deploys. */
export function allPublishCalls(result: PublishResult): PublishCall[] {
  const setup = setupCalls(result);
  const keys = new Set(result.calls.map(callKey));
  const extra = setup.filter((call) => !keys.has(callKey(call)));
  return [...result.calls, ...extra];
}

export function expectedPublishTxs(
  ensVersion: EnsVersion,
  created: { model: boolean; version: boolean },
  setupCount: number,
): {
  base: number;
  setup: number;
  total: number;
  kind: "new model" | "new version" | "idempotent";
} {
  const kind = created.model ? "new model" : created.version ? "new version" : "idempotent";
  const base = created.model ? (ensVersion === "v2" ? 4 : 3) : created.version ? 2 : 0;
  return { base, setup: setupCount, total: base + setupCount, kind };
}

export function formatExpectedTxs(expected: ReturnType<typeof expectedPublishTxs>): string {
  if (expected.kind === "idempotent") {
    return "expected 0 transactions (idempotent)";
  }
  if (expected.setup > 0) {
    return `expected ${expected.total} transactions (${expected.base} ${expected.kind} + ${expected.setup} setup)`;
  }
  return `expected ${expected.total} transactions (${expected.kind})`;
}
