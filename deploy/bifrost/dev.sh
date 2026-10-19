#!/usr/bin/env bash
# A local Bifrost configured like production (config.json, pinned prices, its own Postgres), plus
# Caddy with the production Caddyfile, for the live test and manual checks. Rootless, in one pod.
#   deploy/bifrost/dev.sh up|down [env-file]
# Reads LLM_UPSTREAM_URL, LLM_UPSTREAM_KEY and BIFROST_ADMIN_PASSWORD from the env file (default ~/.config/macaron/dev.env)
# through stdin into local Podman secrets: values are never printed or passed as arguments.
# Then: BIFROST_ADMIN_URL=http://127.0.0.1:18080 (admin API, as the controller sees it) and
# https://localhost:18443/llm/anthropic (what runners see, through Caddy; self-signed).
set -euo pipefail

ACTION="${1:-up}"
ENV_FILE="${2:-$HOME/.config/macaron/dev.env}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$(dirname "$HERE")"
POD=macaron-bifrost-dev

image() { sed -n 's/^Image=//p' "$DEPLOY/quadlets/$1.container"; }

down() {
  podman pod rm --force --ignore "$POD" >/dev/null
  podman secret rm macaron-dev-llm-upstream-key macaron-dev-bifrost-admin macaron-dev-bifrost-db >/dev/null 2>&1 || true
  rm -rf "${XDG_RUNTIME_DIR:-/tmp}/macaron-bifrost-dev"
}

if [[ "$ACTION" == down ]]; then
  down
  echo "removed $POD"
  exit 0
fi
[[ "$ACTION" == up ]] || { echo "usage: $0 up|down [env-file]" >&2; exit 2; }
[[ -r "$ENV_FILE" ]] || { echo "cannot read $ENV_FILE" >&2; exit 1; }

value() { # variable from the env file, on stdout only for pipes
  local line
  line="$(grep -E "^$1=." "$ENV_FILE" | tail -n 1)" || { echo "$1 is not set in $ENV_FILE" >&2; exit 1; }
  printf '%s' "${line#*=}"
}
secret_from_env() { # secret name, variable: the value goes through stdin only
  value "$2" | podman secret create --replace "$1" - >/dev/null
}

down
secret_from_env macaron-dev-llm-upstream-key LLM_UPSTREAM_KEY
secret_from_env macaron-dev-bifrost-admin BIFROST_ADMIN_PASSWORD
openssl rand -hex 24 | tr -d '\n' | podman secret create --replace macaron-dev-bifrost-db - >/dev/null
RENDERED="${XDG_RUNTIME_DIR:-/tmp}/macaron-bifrost-dev"
mkdir -p -m 0700 "$RENDERED"
value LLM_UPSTREAM_URL | "$HERE/render-config.sh" "$RENDERED/config.json"

podman pod create --name "$POD" --publish 127.0.0.1:18080:8080 --publish 127.0.0.1:18443:443 \
  --add-host macaron-postgres:127.0.0.1 --add-host macaron-bifrost:127.0.0.1 >/dev/null

# Postgres initialised directly with the bifrost role and database (production creates them in deploy.sh).
podman run -d --pod "$POD" --name "$POD-postgres" \
  -e POSTGRES_USER=bifrost -e POSTGRES_DB=bifrost --secret macaron-dev-bifrost-db,type=env,target=POSTGRES_PASSWORD \
  "$(image macaron-postgres)" >/dev/null
until podman exec "$POD-postgres" pg_isready -U bifrost -d bifrost >/dev/null 2>&1; do sleep 1; done

podman run -d --pod "$POD" --name "$POD-bifrost" --read-only --tmpfs /app/data:rw,size=64m,mode=1777 \
  -v "$RENDERED/config.json:/app/data/config.json:ro,Z" -v "$HERE:/etc/bifrost:ro,Z" \
  -e LOG_STYLE=json -e BIFROST_ADMIN_USERNAME=macaron \
  --secret macaron-dev-llm-upstream-key,type=env,target=LLM_UPSTREAM_KEY \
  --secret macaron-dev-bifrost-admin,type=env,target=BIFROST_ADMIN_PASSWORD \
  --secret macaron-dev-bifrost-db,type=env,target=BIFROST_DB_PASSWORD \
  --secret macaron-dev-bifrost-db,type=env,target=BIFROST_ENCRYPTION_KEY \
  "$(image macaron-bifrost)" >/dev/null

# The production Caddyfile, with an internal certificate instead of ACME.
podman run -d --pod "$POD" --name "$POD-caddy" -e MACARON_HOST="localhost:443" \
  -v "$DEPLOY/caddy/Caddyfile:/etc/caddy/Caddyfile:ro,Z" \
  "$(image macaron-caddy)" >/dev/null

for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null http://127.0.0.1:18080/health 2>/dev/null; then
    echo "Bifrost up: admin http://127.0.0.1:18080, runners https://localhost:18443/llm/anthropic"
    exit 0
  fi
  sleep 1
done
echo "Bifrost did not become healthy; logs:" >&2
podman logs --tail 30 "$POD-bifrost" >&2
exit 1
