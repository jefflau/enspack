import type { Lockfile } from "./generated/lockfile.js";
import type { Manifest } from "./generated/manifest.js";

export type { Lockfile } from "./generated/lockfile.js";
export type { Manifest } from "./generated/manifest.js";

/** SPEC §3: one `files[]` entry. */
export type ManifestFile = Manifest["files"][number];

/** SPEC §9: one `enspack.lock` models entry. */
export type LockEntry = Lockfile["models"][string];

/** SPEC §3: `distribution` block. */
export type Distribution = Manifest["distribution"];
