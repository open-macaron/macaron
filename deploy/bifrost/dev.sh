#!/usr/bin/env bash
# A local Bifrost configured like production (config.json, pinned prices, its own Postgres), behind
# the production edge (deploy/openshift/edge/nginx.conf) and a TLS terminator standing in for the
# OpenShift router, for the live test and manual checks. Rootless, on one Podman network.
#   deploy/bifrost/dev.sh up|down [env-file]
# Reads BIFROST_ADMIN_PASSWORD from the env file (default ~/.config/macaron/dev.env) through stdin into
# a local Podman secret: it is never printed or passed as an argument. Bifrost holds no LLM key: the
# live test adds the developer's (LLM_UPSTREAM_URL, LLM_UPSTREAM_KEY) for each run, as for a user.
# Then: BIFROST_ADMIN_URL=http://127.0.0.1:18080 (admin API, as the controller sees it) and
# https://localhost:18443/llm/anthropic (what runners see, through the edge; self-signed).
set -euo pipefail

ACTION="${1:-up}"
ENV_FILE="${2:-$HOME/.config/macaron/dev.env}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENSHIFT="$(dirname "$HERE")/openshift"
NAME=macaron-bifrost-dev
# Production's Postgres is registry.redhat.io/rhel10/postgresql-18, which needs a Red Hat login; this
# is its public CentOS Stream build, with the same scripts.
POSTGRES_IMAGE=quay.io/sclorg/postgresql-18-c10s@sha256:dc3d303c0a2f4508af30fc6de4624293c657b1c678bcc45304144de1df95102c
# Only terminates TLS, as the router does in production; the routing contract is nginx's.
CADDY_IMAGE=docker.io/library/caddy@sha256:685ae3d7c34d9b5f8caeddc5d14051db7bbd88ff1f5a2fa0c16bd8ca328fb7af

image() { sed -n 's/^ *image: //p' "$OPENSHIFT/$1" | head -n 1; } # the digest production runs

down() {
  podman rm --force --ignore "$NAME-tls" "$NAME-edge" "$NAME-bifrost" "$NAME-postgres" >/dev/null
  podman network rm --force "$NAME" >/dev/null 2>&1 || true
  podman secret rm macaron-dev-bifrost-admin macaron-dev-bifrost-db >/dev/null 2>&1 || true
  rm -rf "${XDG_RUNTIME_DIR:-/tmp}/macaron-bifrost-dev"
}

if [[ "$ACTION" == down ]]; then
  down
  echo "removed $NAME"
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
secret_from_env macaron-dev-bifrost-admin BIFROST_ADMIN_PASSWORD
openssl rand -hex 24 | tr -d '\n' | podman secret create --replace macaron-dev-bifrost-db - >/dev/null
RENDERED="${XDG_RUNTIME_DIR:-/tmp}/macaron-bifrost-dev"
mkdir -p "$RENDERED" && chmod 0700 "$RENDERED"
sh "$HERE/render-config.sh" "$RENDERED/config.json"
podman network create "$NAME" >/dev/null

# Postgres with the bifrost role and database only, and no TLS (render-config's default sslmode).
podman run -d --network "$NAME" --network-alias macaron-postgres --name "$NAME-postgres" \
  -e POSTGRESQL_USER=bifrost -e POSTGRESQL_DATABASE=bifrost \
  --secret macaron-dev-bifrost-db,type=env,target=POSTGRESQL_PASSWORD \
  "$POSTGRES_IMAGE" >/dev/null
until podman exec "$NAME-postgres" pg_isready -h 127.0.0.1 -d bifrost >/dev/null 2>&1; do sleep 1; done

podman run -d --network "$NAME" --network-alias macaron-bifrost --name "$NAME-bifrost" --publish 127.0.0.1:18080:8080 \
  --read-only --tmpfs /app/data:rw,size=64m,mode=1777 \
  -v "$RENDERED/config.json:/app/data/config.json:ro,Z" -v "$HERE:/etc/bifrost:ro,Z" \
  -e LOG_STYLE=json -e BIFROST_ADMIN_USERNAME=macaron \
  --secret macaron-dev-bifrost-admin,type=env,target=BIFROST_ADMIN_PASSWORD \
  --secret macaron-dev-bifrost-db,type=env,target=BIFROST_DB_PASSWORD \
  --secret macaron-dev-bifrost-db,type=env,target=BIFROST_ENCRYPTION_KEY \
  "$(image bifrost.yaml)" >/dev/null

# The production edge. No controller or web app runs here: their routes answer 502.
podman run -d --network "$NAME" --network-alias macaron-edge --name "$NAME-edge" --add-host macaron-controller:127.0.0.1 --add-host macaron-web:127.0.0.1 \
  --read-only --tmpfs /tmp -v "$OPENSHIFT/edge/nginx.conf:/etc/nginx-macaron/nginx.conf:ro,Z" \
  "$(image edge.yaml)" nginx -e stderr -c /etc/nginx-macaron/nginx.conf -g 'daemon off;' >/dev/null

podman run -d --network "$NAME" --name "$NAME-tls" --publish 127.0.0.1:18443:443 \
  "$CADDY_IMAGE" caddy reverse-proxy --from https://localhost:443 --to macaron-edge:8080 --internal-certs >/dev/null

for _ in $(seq 1 120); do
  if curl -fsS -o /dev/null http://127.0.0.1:18080/health 2>/dev/null; then
    echo "Bifrost up: admin http://127.0.0.1:18080, runners https://localhost:18443/llm/anthropic"
    exit 0
  fi
  sleep 1
done
echo "Bifrost did not become healthy; logs:" >&2
podman logs --tail 30 "$NAME-bifrost" >&2
exit 1
