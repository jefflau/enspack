/** HTTP error body for the registrar (MVP.md §4: `{ error, code }`). */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function jsonError(error: string, code: string): { error: string; code: string } {
  return { error, code };
}
