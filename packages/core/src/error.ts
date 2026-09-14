export type EnspackErrorCode =
  | "RESOLVE"
  | "FETCH"
  | "VERIFY"
  | "LOCK"
  | "DOWNLOAD"
  | "PUBLISH"
  | "POLICY";

/** CLI maps these to process exit codes (MVP.md WP-08). */
export const EXIT_CODES: Record<EnspackErrorCode, number> = {
  RESOLVE: 2,
  FETCH: 2,
  VERIFY: 3,
  LOCK: 3,
  DOWNLOAD: 4,
  PUBLISH: 5,
  POLICY: 5,
};

/** Typed failure for every enspack package (AGENTS.md conventions). */
export class EnspackError extends Error {
  readonly code: EnspackErrorCode;

  constructor(code: EnspackErrorCode, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "EnspackError";
    this.code = code;
  }
}

/** Narrow unknown failures to EnspackError (CLI exit-code mapping). */
export function isEnspackError(e: unknown): e is EnspackError {
  return e instanceof EnspackError;
}
