#!/usr/bin/env bash
# Idempotent one-box deploy: rsync this repo to /opt/enspack and compose up.
set -euo pipefail

usage() {
  printf 'usage: %s <user@host>\n' "${0##*/}" >&2
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

"${ssh_cmd[@]}" "$HOST" "cd $(printf '%q' "$REMOTE") && docker compose -f infra/docker-compose.yml up -d --build"

DOMAIN=""
if [[ -f "$ROOT/infra/.env" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      DOMAIN=*)
        DOMAIN="${line#DOMAIN=}"
        DOMAIN="${DOMAIN%\"}"
        DOMAIN="${DOMAIN#\"}"
        DOMAIN="${DOMAIN%\'}"
        DOMAIN="${DOMAIN#\'}"
        ;;
    esac
  done < "$ROOT/infra/.env"
fi
if [[ -z "$DOMAIN" ]]; then
  printf 'DOMAIN is not set in infra/.env; cannot wait for HTTPS health\n' >&2
  exit 1
fi

seed_url="https://seed1.${DOMAIN}/v1/health"
registrar_url="https://registrar.${DOMAIN}/v1/health"
index_url="https://index.${DOMAIN}/v1/health"

wait_url() {
  local url="$1"
  local i
  for i in $(seq 1 60); do
    if curl -fsS --max-time 10 "$url" >/dev/null; then
      return 0
    fi
    sleep 5
  done
  printf 'timed out waiting for %s\n' "$url" >&2
  exit 1
}

wait_url "$seed_url"
wait_url "$registrar_url"
wait_url "$index_url"

printf '%s\n' "$seed_url" "$registrar_url" "$index_url"
