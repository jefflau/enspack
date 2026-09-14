import { getAddress, isAddress } from "viem";
import { HttpError } from "./http-error.js";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * SPEC §7: claim `address` must be a checksummed or lowercase 0x address.
 */
export function parseClaimAddress(value: unknown): `0x${string}` {
  if (
    typeof value !== "string" ||
    !ADDRESS_RE.test(value) ||
    !isAddress(value, { strict: false })
  ) {
    throw new HttpError(
      400,
      "INVALID_ADDRESS",
      "address must be a checksummed or lowercase 0x address",
    );
  }
  const lower = value.toLowerCase();
  if (value === lower) {
    return value as `0x${string}`;
  }
  if (value === getAddress(value)) {
    return value as `0x${string}`;
  }
  throw new HttpError(
    400,
    "INVALID_ADDRESS",
    "address must be a checksummed or lowercase 0x address",
  );
}

/** SPEC §7: exact bytes committed to `enspack-verify.txt`. */
export function verifyFileContents(challenge: string, address: string): string {
  return `${challenge}\n${address}\n`;
}

/**
 * SPEC §7 steps 2–4: human instructions for the claim page and 201 payload.
 */
export function claimInstructions(hfNamespace: string, challenge: string, address: string): string {
  const file = verifyFileContents(challenge, address);
  return [
    `Commit enspack-verify.txt to a public Hugging Face repo under "${hfNamespace}" (model, dataset, or space).`,
    "The file must contain exactly the following bytes (challenge, newline, address, newline):",
    file,
    `Sign the challenge with ${address} using EIP-191 personal_sign.`,
    'Then POST /v1/claims/:id/verify with { "repo": "<hfNamespace>/<name>", "signature": "<hex>" }.',
  ].join("\n");
}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** SPEC §7 step 1: `enspack-verify:` + 32 random bytes hex. */
export function makeChallenge(randomBytes32: Uint8Array): string {
  if (randomBytes32.byteLength !== 32) {
    throw new Error("challenge entropy must be 32 bytes");
  }
  return `enspack-verify:${bytesToHex(randomBytes32)}`;
}

export const CLAIM_TTL_MS = 24 * 60 * 60 * 1000;
