import { LICENSE_ALLOWLIST } from "@enspack/core";
import { parse } from "yaml";
import { DEFAULT_PUBLISHER, DEFAULT_WEBSEEDS } from "./constants.js";
import type { ModelEntry, ModelsConfig } from "./types.js";

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function parseModel(raw: unknown, index: number): ModelEntry {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`models.yaml models[${index}] is not a mapping`);
  }
  const rec = raw as Record<string, unknown>;
  const repo = asString(rec.repo);
  const expected = asString(rec.expected_license);
  const revision = asString(rec.revision);
  const tier = asNumber(rec.tier);
  if (!repo || !expected || !revision || tier === undefined) {
    throw new Error(
      `models.yaml models[${index}] missing repo, expected_license, revision, or tier`,
    );
  }
  const entry: ModelEntry = {
    repo,
    tier,
    expected_license: expected,
    revision,
  };
  const storage = asNumber(rec.storage_gb);
  if (storage !== undefined) entry.storage_gb = storage;
  const note = asString(rec.note);
  if (note !== undefined) entry.note = note;
  const example = asString(rec.example);
  if (example !== undefined) entry.example = example;
  return entry;
}

/**
 * BOOTSTRAP.md §3: load `bootstrap/models.yaml`. Entries themselves are not rewritten.
 */
export function parseModelsYaml(text: string): ModelsConfig {
  const parsed: unknown = parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("models.yaml must be a mapping");
  }
  const rec = parsed as Record<string, unknown>;
  const publisher = asString(rec.publisher) ?? DEFAULT_PUBLISHER;
  const allow = rec.license_allowlist;
  const licenseAllowlist: readonly string[] = Array.isArray(allow)
    ? allow.filter((x): x is string => typeof x === "string")
    : [...LICENSE_ALLOWLIST];
  const web = rec.webseeds;
  let huggingface: string = DEFAULT_WEBSEEDS.huggingface;
  let huggingbay: string = DEFAULT_WEBSEEDS.huggingbay;
  if (web !== null && typeof web === "object" && !Array.isArray(web)) {
    const w = web as Record<string, unknown>;
    huggingface = asString(w.huggingface) ?? huggingface;
    huggingbay = asString(w.huggingbay) ?? huggingbay;
  }
  const modelsRaw = rec.models;
  if (!Array.isArray(modelsRaw)) {
    throw new Error("models.yaml missing models[]");
  }
  return {
    publisher,
    licenseAllowlist,
    webseeds: { huggingface, huggingbay },
    models: modelsRaw.map(parseModel),
  };
}

export function selectModels(
  config: ModelsConfig,
  opts: { tier?: number; only?: string[]; limit?: number },
): ModelEntry[] {
  const only = opts.only !== undefined && opts.only.length > 0 ? new Set(opts.only) : undefined;
  let selected = config.models.filter((m) => {
    if (opts.tier !== undefined && m.tier !== opts.tier) return false;
    if (only !== undefined && !only.has(m.repo)) return false;
    return true;
  });
  if (opts.limit !== undefined) {
    selected = selected.slice(0, opts.limit);
  }
  return selected;
}
