import { EnspackError } from "./error.js";

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertCanonicalValue(value: unknown, path: string): void {
  if (value === undefined) {
    throw new EnspackError("VERIFY", `canonicalJson: undefined at ${path}`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new EnspackError("VERIFY", `canonicalJson: non-finite number at ${path}`);
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return;
  }
  if (typeof value === "number") {
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      assertCanonicalValue(value[i], `${path}[${i}]`);
    }
    return;
  }
  if (typeof value === "object") {
    if (!isPlainObject(value)) {
      throw new EnspackError("VERIFY", `canonicalJson: non-plain object at ${path}`);
    }
    for (const [key, nested] of Object.entries(value)) {
      assertCanonicalValue(nested, `${path}.${key}`);
    }
    return;
  }
  throw new EnspackError("VERIFY", `canonicalJson: unsupported type at ${path}`);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const nested = obj[key];
      sorted[key] = sortValue(nested);
    }
    return sorted;
  }
  return value;
}

/**
 * SPEC §3: serialize with recursively sorted keys and no whitespace so identical content yields identical CIDs.
 */
export function canonicalJson(obj: unknown): Uint8Array {
  if (obj === undefined) {
    throw new EnspackError("VERIFY", "canonicalJson: undefined");
  }
  assertCanonicalValue(obj, "$");
  return new TextEncoder().encode(JSON.stringify(sortValue(obj)));
}
