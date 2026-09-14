import { EnspackError, type ManifestFile } from "@enspack/core";

/** `files[].role` heuristic for HF paths (SPEC §3). */
export type FileRole = NonNullable<ManifestFile["role"]>;

/** Schema `files[].path` rules (SPEC §3): relative POSIX, no `..`, no leading `/`, no `\`. */
export const MANIFEST_PATH_RE = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[^\\]+$/;

/**
 * Assign `role` from a POSIX-relative path. Order is license → tokenizer →
 * index → config → weight → doc → code so the example manifest wins on
 * overlapping names (`tokenizer_config.json`, `merges.txt`).
 */
export function fileRole(path: string): FileRole {
  const name = path.split("/").pop() ?? path;
  const lower = name.toLowerCase();

  if (lower.startsWith("license") || lower.startsWith("notice") || lower.startsWith("copying")) {
    return "license";
  }
  if (
    lower.startsWith("tokenizer") ||
    lower.startsWith("vocab") ||
    lower === "merges.txt" ||
    lower.endsWith(".model") ||
    lower.endsWith(".tiktoken") ||
    lower === "special_tokens_map.json" ||
    lower === "added_tokens.json"
  ) {
    return "tokenizer";
  }
  if (lower.endsWith(".index.json")) return "index";
  if (
    lower === "config.json" ||
    lower === "generation_config.json" ||
    lower === "preprocessor_config.json" ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".yml") ||
    lower.endsWith("_config.json")
  ) {
    return "config";
  }
  if (
    lower.endsWith(".safetensors") ||
    lower.endsWith(".bin") ||
    lower.endsWith(".gguf") ||
    lower.endsWith(".pt") ||
    lower.endsWith(".pth") ||
    lower.endsWith(".onnx") ||
    lower.endsWith(".msgpack") ||
    lower.endsWith(".h5") ||
    lower.endsWith(".ckpt")
  ) {
    return "weight";
  }
  if (lower.endsWith(".md") || lower.endsWith(".txt")) return "doc";
  if (lower.endsWith(".py") || lower.endsWith(".cpp") || lower.endsWith(".js")) return "code";
  return "other";
}

export function assertManifestPath(path: string): void {
  if (path.length < 1 || path.length > 1024 || !MANIFEST_PATH_RE.test(path)) {
    throw new EnspackError("VERIFY", `invalid manifest path ${JSON.stringify(path)}`);
  }
}

export function sortByPath(files: ManifestFile[]): ManifestFile[] {
  return files.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
