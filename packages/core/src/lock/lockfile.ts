import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { EnspackError, isEnspackError } from "../error.js";
import type { Resolved } from "../interfaces.js";
import { parseRef } from "../labels.js";
import type { LockEntry, Lockfile, Manifest } from "../types.js";
import { validateLock } from "../validate.js";

const DEFAULT_LOCK_PATH = "enspack.lock";

function isErrno(e: unknown): e is { code: string } {
  return e !== null && typeof e === "object" && "code" in e && typeof e.code === "string";
}

function normalizeEntry(entry: LockEntry): LockEntry {
  const out: LockEntry = {
    resolved: entry.resolved,
    cid: entry.cid,
    infohash: entry.infohash,
    totalSize: entry.totalSize,
  };
  if (entry.select !== undefined) {
    out.select = entry.select;
  }
  if (entry.upstream !== undefined) {
    out.upstream = entry.upstream;
  }
  return out;
}

/**
 * SPEC §9: serialize with `models` keys sorted and 2-space indent + trailing newline.
 */
export function serializeLock(lock: Lockfile): string {
  const models: Lockfile["models"] = {};
  for (const key of Object.keys(lock.models).sort()) {
    const entry = lock.models[key];
    if (entry === undefined) {
      continue;
    }
    models[key] = normalizeEntry(entry);
  }
  const sorted: Lockfile = { lockfileVersion: 1, models };
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/**
 * SPEC §9: read `enspack.lock` via `validateLock`. Missing file → empty lock
 * `{ lockfileVersion: 1, models: {} }`. Malformed JSON or schema-invalid → LOCK.
 */
export async function readLock(path = DEFAULT_LOCK_PATH): Promise<Lockfile> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (cause) {
    if (isErrno(cause) && cause.code === "ENOENT") {
      return { lockfileVersion: 1, models: {} };
    }
    throw new EnspackError("LOCK", `failed to read lockfile ${path}`, cause);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new EnspackError("LOCK", `malformed lockfile ${path}`, cause);
  }
  try {
    return validateLock(parsed);
  } catch (cause) {
    if (isEnspackError(cause)) {
      throw new EnspackError("LOCK", cause.message, cause);
    }
    throw new EnspackError("LOCK", `invalid lockfile ${path}`, cause);
  }
}

/**
 * SPEC §9: validate, sort `models` keys, `JSON.stringify(lock, null, 2) + "\\n"`,
 * atomic write (tmp + rename).
 */
export async function writeLock(lock: Lockfile, path = DEFAULT_LOCK_PATH): Promise<void> {
  const valid = validateLock(lock);
  const body = serializeLock(valid);
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.enspack-lock.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(tmp, body, "utf8");
    await rename(tmp, path);
  } catch (cause) {
    try {
      await unlinkIfExists(tmp);
    } catch {
      // ignore cleanup
    }
    throw new EnspackError("LOCK", `failed to write lockfile ${path}`, cause);
  }
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // ignore leftover tmp on a failed rename
  }
}

/**
 * SPEC §9: build a lock entry from a successful resolution (`cid` required).
 * `select` defaults to `["*"]`. `upstream` is copied when the manifest has it.
 */
export function lockEntryFrom(
  resolved: Resolved & { manifest: Manifest },
  select?: string[],
): LockEntry {
  if (resolved.cid === null || resolved.cid === "") {
    throw new EnspackError("LOCK", `cannot lock ${resolved.name}: resolution has no CID`);
  }
  const entry: LockEntry = {
    resolved: resolved.manifest.name,
    cid: resolved.cid,
    infohash: resolved.manifest.distribution.infohash,
    totalSize: resolved.manifest.totalSize,
    select: select ?? ["*"],
  };
  const upstream = resolved.manifest.upstream;
  if (upstream !== undefined) {
    entry.upstream = { repo: upstream.repo, revision: upstream.revision };
  }
  return entry;
}

/**
 * SPEC §9 `enspack add`: append `key` → `entry`. Existing key is a LOCK error.
 */
export function addToLock(lock: Lockfile, key: string, entry: LockEntry): Lockfile {
  if (lock.models[key] !== undefined) {
    throw new EnspackError("LOCK", `${key} is already in the lockfile; run enspack update`);
  }
  return validateLock({
    lockfileVersion: 1 as const,
    models: { ...lock.models, [key]: entry },
  });
}

/**
 * SPEC §9 `enspack update`: rewrite `key` → `entry`. Missing key is a LOCK error.
 */
export function updateLock(lock: Lockfile, key: string, entry: LockEntry): Lockfile {
  if (lock.models[key] === undefined) {
    throw new EnspackError("LOCK", `${key} is not in the lockfile; run enspack add`);
  }
  return validateLock({
    lockfileVersion: 1 as const,
    models: { ...lock.models, [key]: entry },
  });
}

/**
 * SPEC §9: drop `key` from `models`. Missing key is a LOCK error.
 */
export function removeFromLock(lock: Lockfile, key: string): Lockfile {
  if (lock.models[key] === undefined) {
    throw new EnspackError("LOCK", `${key} is not in the lockfile`);
  }
  const models = { ...lock.models };
  delete models[key];
  return { lockfileVersion: 1, models };
}

/**
 * Lookup rule (SPEC §4 step 5 / §9): exact `models` key, else any entry whose
 * `resolved === name` (so a model-name key still matches a version-name resolve).
 */
export function findLockEntry(
  lock: Lockfile,
  name: string,
): { key: string; entry: LockEntry } | undefined {
  const direct = lock.models[name];
  if (direct !== undefined) {
    return { key: name, entry: direct };
  }
  for (const [key, entry] of Object.entries(lock.models)) {
    if (entry.resolved === name) {
      return { key, entry };
    }
  }
  return undefined;
}

/**
 * SPEC §4 step 5 / §6.2: if a lock entry exists for `name` and `entry.cid !== cid`,
 * throw LOCK unless `update` is true. Lookup: exact key, else `resolved === name`.
 */
export function assertLockMatch(
  lock: Lockfile,
  name: string,
  cid: string,
  opts?: { update?: boolean },
): void {
  const found = findLockEntry(lock, name);
  if (found === undefined) {
    return;
  }
  if (found.entry.cid === cid) {
    return;
  }
  if (opts?.update === true) {
    return;
  }
  throw new EnspackError(
    "LOCK",
    `${name} resolved to ${cid} but enspack.lock pins ${found.entry.cid}; run enspack update to accept`,
  );
}

/**
 * SPEC §9: lockfile `models` keys are ENS names. Via `parseRef(ref)`,
 * `name@version` refs key by the **model** name (the part before `@`) so
 * `enspack update` can re-resolve; a bare version name keys by itself.
 */
export function lockKeyFor(ref: string): string {
  const trimmed = ref.trim();
  parseRef(trimmed);
  const at = trimmed.lastIndexOf("@");
  if (at >= 0) {
    return trimmed.slice(0, at);
  }
  return trimmed;
}
