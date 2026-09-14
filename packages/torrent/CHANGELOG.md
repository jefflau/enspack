# @enspack/torrent

## 0.1.0

- Initial release (WP-06): BitTorrent v1 metainfo create/parse (SPEC §8 step 2, §3),
  magnet validation (SPEC §4), `Aria2Downloader` (SPEC §4 step 7), streaming
  `Sha256Verifier` and quarantine (SPEC §4 step 8).
- `--select` on a torrent+webseed download uses `--select-file` plus
  `--bt-remove-unselected-file` so dest contains only matching files.
