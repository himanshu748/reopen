#!/usr/bin/env bash
set -euo pipefail
command -v docker >/dev/null
if docker compose version >/dev/null 2>&1; then
  compose=(docker compose)
elif [[ -n "${REOPEN_COMPOSE_BIN:-}" && -x "$REOPEN_COMPOSE_BIN" ]]; then
  compose=("$REOPEN_COMPOSE_BIN")
elif command -v docker-compose >/dev/null; then
  compose=(docker-compose)
else
  echo 'Docker Compose is required. Install the official Compose plugin, or set REOPEN_COMPOSE_BIN to a verified official standalone binary.' >&2
  exit 2
fi
: "${REOPEN_JUDGE_PASSWORD:?Set a private REOPEN_JUDGE_PASSWORD of at least 12 characters in the environment}"
mkdir -p .judge
"${compose[@]}" -f compose.judge.yaml up --build --wait -d
for attempt in $(seq 1 20); do
  if "${compose[@]}" -f compose.judge.yaml cp caddy:/data/caddy/pki/authorities/local/root.crt .judge/root.crt 2>/dev/null; then break; fi
  sleep 1
done
test -s .judge/root.crt
curl --fail --silent --show-error --cacert .judge/root.crt https://localhost:8443/api/health > .judge/https-health.json
NODE_EXTRA_CA_CERTS="$PWD/.judge/root.crt" REOPEN_JUDGE_ORIGIN=https://localhost:8443 node scripts/judge-mcp.mjs
