import { EnspackError } from "@enspack/core";

/**
 * MVP.md WP-09: `manifest.publisher` must equal an allow-root or end with `.<root>`.
 */
export function checkAllowRoots(publisher: string, allowRoots: readonly string[]): void {
  const ok = allowRoots.some((root) => publisher === root || publisher.endsWith(`.${root}`));
  if (!ok) {
    throw new EnspackError("POLICY", `publisher ${publisher} is outside allowRoots`);
  }
}

/**
 * MVP.md WP-09: `manifest.license` must be in the seed license allowlist.
 */
export function checkLicense(license: string, allowlist: readonly string[]): void {
  const normalized = license.trim().toLowerCase();
  if (!allowlist.some((item) => item.toLowerCase() === normalized)) {
    throw new EnspackError("POLICY", `license ${license} is not in the allowlist`);
  }
}

/**
 * MVP.md WP-09: sum of already-seeded `totalSize` for this publisher plus this manifest must be ≤ quota.
 */
export function checkQuota(
  publisher: string,
  usedBytes: number,
  additionalBytes: number,
  quotaBytes: number,
): void {
  if (usedBytes + additionalBytes > quotaBytes) {
    throw new EnspackError("POLICY", `publisher ${publisher} exceeds quota of ${quotaBytes} bytes`);
  }
}
