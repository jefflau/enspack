#!/usr/bin/env bash
# Run enspack-bootstrap plan then run on the box via the bootstrap compose profile.
set -euo pipefail

usage() {
  printf 'usage: %s <user@host> [--tier 1] [--limit 3]\n' "${0##*/}" >&2
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
  usage
  exit 0
fi
if [[ "$1" == -* ]]; then
  usage
  exit 1
fi

HOST="$1"
shift
TIER=1
LIMIT=3
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tier)
      TIER="${2:?--tier requires a value}"
      shift 2
      ;;
    --limit)
      LIMIT="${2:?--limit requires a value}"
      shift 2
      ;;
    *)
      printf 'unexpected argument: %s\n' "$1" >&2
      usage
      exit 1
      ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${ENSPACK_REMOTE_ROOT:-/opt/enspack}"

ssh_cmd=(ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
if [[ -n "${SSH_KEY_FILE:-}" ]]; then
  ssh_cmd+=(-i "$SSH_KEY_FILE")
fi

rsync -az --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .git \
  --exclude .ponder \
  --exclude .env \
  --exclude '*.log' \
  -e "${ssh_cmd[*]}" \
  "$ROOT/" \
  "$HOST:$REMOTE/"

if [[ -f "$ROOT/infra/.env" ]]; then
  rsync -az -e "${ssh_cmd[*]}" "$ROOT/infra/.env" "$HOST:$REMOTE/infra/.env"
fi

compose=(docker compose -f infra/docker-compose.yml --profile bootstrap)
remote_q=$(printf '%q' "$REMOTE")
tier_q=$(printf '%q' "$TIER")
limit_q=$(printf '%q' "$LIMIT")

"${ssh_cmd[@]}" "$HOST" "cd ${remote_q} && ${compose[*]} run --rm bootstrap plan --tier ${tier_q} --limit ${limit_q} --chain sepolia --json"
"${ssh_cmd[@]}" "$HOST" "cd ${remote_q} && ${compose[*]} run --rm bootstrap run --tier ${tier_q} --limit ${limit_q} --chain sepolia --pin seed --seed-node http://seed-api:8080 --downloads /downloads --resume"
