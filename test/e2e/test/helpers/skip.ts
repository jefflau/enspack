/**
 * MVP.md WP-13 / WP-08: Sepolia E2E runs only when both secrets are present.
 * Matches `describe.skipIf(!process.env.SEPOLIA_RPC_URL || !process.env.ENSPACK_PUBLISHER_KEY)`.
 */
export function shouldSkipSepolia(env: NodeJS.ProcessEnv = process.env): boolean {
  return !env.SEPOLIA_RPC_URL || !env.ENSPACK_PUBLISHER_KEY;
}
