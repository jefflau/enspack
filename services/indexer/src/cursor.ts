/**
 * MVP.md §4.3: opaque pagination cursor is base64 of the last model name.
 */
export function encodeNamesCursor(model: string): string {
  return Buffer.from(model, "utf8").toString("base64");
}

/**
 * MVP.md §4.3: decode an opaque names cursor; garbage input is a hard error.
 */
export function decodeNamesCursor(cursor: string): string {
  const decoded = Buffer.from(cursor, "base64").toString("utf8");
  if (decoded === "") {
    throw new Error("invalid cursor");
  }
  return decoded;
}
