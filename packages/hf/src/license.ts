import { EnspackError, LICENSE_ALLOWLIST } from "@enspack/core";

/** SPDX ids accepted for mirroring (BOOTSTRAP.md §2). */
export type LicenseAllowlist = ReadonlySet<string> | readonly string[];

/** `override` maps to SPEC §11 `--i-have-redistribution-rights`. */
export interface LicenseGateOptions {
  allowlist?: LicenseAllowlist;
  override?: boolean;
}

function allowlistHas(allowlist: LicenseAllowlist, license: string): boolean {
  if (allowlist instanceof Set) return allowlist.has(license);
  for (const item of allowlist) {
    if (item === license) return true;
  }
  return false;
}

/**
 * Refuse a missing or non-allowlisted license unless `override` is set
 * (BOOTSTRAP.md §2 rule 2; SPEC §11 `--i-have-redistribution-rights`).
 */
export function licenseGate(
  license: string | null | undefined,
  opts: LicenseGateOptions = {},
): void {
  const override = opts.override === true;
  if (override) return;
  const allowlist = opts.allowlist ?? LICENSE_ALLOWLIST;
  const normalized = license?.trim().toLowerCase() ?? "";
  if (!normalized || !allowlistHas(allowlist, normalized)) {
    throw new EnspackError(
      "POLICY",
      `license ${license == null || license === "" ? "missing" : JSON.stringify(license)} is not on the redistribution allowlist`,
    );
  }
}
