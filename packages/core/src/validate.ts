import addFormats from "ajv-formats";
import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import { normalize } from "viem/ens";
import lockSchema from "../../../schema/enspack.lock.schema.json" with { type: "json" };
import manifestSchema from "../../../schema/enspack.schema.json" with { type: "json" };
import { EnspackError } from "./error.js";
import type { Lockfile, Manifest } from "./types.js";

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);

const manifestValidator = ajv.compile(manifestSchema);
const lockValidator = ajv.compile(lockSchema);

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) {
    return "unknown schema error";
  }
  return errors
    .map((e) => {
      const path = e.instancePath === "" ? "/" : e.instancePath;
      const msg = e.message ?? "invalid";
      return `${path} ${msg}`;
    })
    .join("; ");
}

function assertNormalizedName(field: string, value: string): void {
  let normalized: string;
  try {
    normalized = normalize(value);
  } catch (cause) {
    throw new EnspackError("VERIFY", `${field} failed ENS normalization`, cause);
  }
  if (normalized !== value) {
    throw new EnspackError(
      "VERIFY",
      `${field} must pass viem/ens normalize() unchanged (got "${normalized}")`,
    );
  }
}

function assertManifestRules(manifest: Manifest): void {
  const magnetXt = manifest.distribution.magnet.match(/xt=urn:btih:([0-9a-fA-F]{40})/i);
  const xt = magnetXt?.[1];
  if (xt === undefined || xt.toLowerCase() !== manifest.distribution.infohash.toLowerCase()) {
    throw new EnspackError(
      "VERIFY",
      "distribution.magnet xt=urn:btih: must equal distribution.infohash",
    );
  }

  const paths = new Set<string>();
  let sizeSum = 0;
  for (const file of manifest.files) {
    if (paths.has(file.path)) {
      throw new EnspackError("VERIFY", `duplicate files[].path "${file.path}"`);
    }
    paths.add(file.path);
    sizeSum += file.size;
  }

  if (sizeSum !== manifest.totalSize) {
    throw new EnspackError(
      "VERIFY",
      `totalSize ${manifest.totalSize} !== sum(files[].size) ${sizeSum}`,
    );
  }

  const last = manifest.versions[manifest.versions.length - 1];
  if (last === undefined) {
    throw new EnspackError("VERIFY", "versions[] must include the current version as its last entry");
  }
  if (last.name !== manifest.name || last.version !== manifest.version) {
    throw new EnspackError(
      "VERIFY",
      "versions[] last entry .name and .version must equal manifest.name and manifest.version",
    );
  }

  for (const url of manifest.distribution.webseeds) {
    if (!url.endsWith("/")) {
      throw new EnspackError("VERIFY", `webseeds[] entry must end with "/": ${url}`);
    }
  }

  assertNormalizedName("name", manifest.name);
  assertNormalizedName("model", manifest.model);
  assertNormalizedName("publisher", manifest.publisher);

  if (!manifest.name.endsWith(`.${manifest.model}`)) {
    throw new EnspackError("VERIFY", `name must end with ".${manifest.model}"`);
  }
  if (!manifest.model.endsWith(`.${manifest.publisher}`)) {
    throw new EnspackError("VERIFY", `model must end with ".${manifest.publisher}"`);
  }
}

/**
 * SPEC §3: validate against schema/enspack.schema.json plus rules JSON Schema cannot express.
 */
export function validateManifest(x: unknown): Manifest {
  if (!manifestValidator(x)) {
    throw new EnspackError("VERIFY", formatAjvErrors(manifestValidator.errors));
  }
  const manifest = x as Manifest;
  assertManifestRules(manifest);
  return manifest;
}

/**
 * SPEC §9: validate against schema/enspack.lock.schema.json.
 */
export function validateLock(x: unknown): Lockfile {
  if (!lockValidator(x)) {
    throw new EnspackError("VERIFY", formatAjvErrors(lockValidator.errors));
  }
  return x as Lockfile;
}
