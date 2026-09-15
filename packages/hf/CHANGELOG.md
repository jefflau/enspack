# @enspack/hf

## 0.1.0

- WP-22: `HuggingBayClient.lock` returns `null` on HTTP 404 and 409 (no lock);
  other non-2xx still FETCH. Callers skip the cross-check when there is no lock.
- Hugging Face Hub client: tree (paginated), revision resolve, model info, license lookup, size-capped download, `buildFiles` (SPEC §8 step 1).
- Hugging Bay client: `resolve`, `lock`, `submitFallback` (SPEC §8 step 6, §10).
- `crossCheck` against a Hugging Bay lock (SPEC §8 step 1) and `hfWebseed` (SPEC §3).
- `licenseGate` against `LICENSE_ALLOWLIST` (BOOTSTRAP.md §2, SPEC §11).
