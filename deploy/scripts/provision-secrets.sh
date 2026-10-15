#!/usr/bin/env bash
# Creates the controller's Podman secrets and settings ON THE VPS, from a local env file.
# Run from a developer machine; every remote action goes through ssh, values never hit the
# terminal or the remote shell history (they travel on stdin):
#   deploy/scripts/provision-secrets.sh [ssh-host] [env-file]
# Re-running replaces the GitHub/OpenRouter/webhook secrets; the database password is created
# once and never rotated by this script (the database was initialised with it).
set -euo pipefail

HOST="${1:-open-macaron-vps}"
ENV_FILE="${2:-$HOME/.config/macaron/dev.env}"
[[ -r "$ENV_FILE" ]] || { echo "cannot read $ENV_FILE" >&2; exit 1; }

value() {
  local line
  line="$(grep -E "^$1=" "$ENV_FILE" | tail -n 1)" || true
  [[ -n "$line" ]] || { echo "$1 is not set in $ENV_FILE" >&2; exit 1; }
  printf '%s' "${line#*=}"
}

remote_secret() { # name, env var — the value goes through stdin only
  value "$2" | ssh -o BatchMode=yes "$HOST" "sudo podman secret create --replace $1 - >/dev/null" && echo "   $1"
}

echo "==> secrets on $HOST"
remote_secret macaron-gh-interact GH_INTERACT
remote_secret macaron-gh-push GH_PUSH
remote_secret macaron-gh-org GH_ORG
remote_secret macaron-or-provisioning OPENROUTER_PROVISIONING_KEY
remote_secret macaron-or-router OPENROUTER_ROUTER_KEY
remote_secret macaron-webhook-hmac WEBHOOK_HMAC

# Database credentials are generated on the VPS itself, once.
ssh -o BatchMode=yes "$HOST" 'sudo bash -s' <<'REMOTE'
set -euo pipefail
if ! podman secret exists macaron-pg-password; then
  password="$(openssl rand -hex 24)"
  printf '%s' "$password" | podman secret create macaron-pg-password - >/dev/null
  printf 'postgres://macaron:%s@macaron-postgres:5432/macaron' "$password" | podman secret create macaron-database-url - >/dev/null
  echo "   macaron-pg-password, macaron-database-url (generated)"
else
  echo "   macaron-pg-password, macaron-database-url (kept)"
fi
REMOTE

echo "==> settings on $HOST"
{
  printf 'PUBLIC_URL=%s\n' "$(value PUBLIC_URL)"
  printf 'MACARON_ENABLED=%s\n' "${MACARON_ENABLED:-false}"
  printf 'LOG_LEVEL=%s\n' "${LOG_LEVEL:-info}"
  printf 'RUNNER_REPO_ID=%s\n' "$(value RUNNER_REPO_ID)"
  printf 'RUNNER_OWNER_ID=%s\n' "$(value RUNNER_OWNER_ID)"
  printf 'OPENROUTER_WORKSPACE=%s\n' "$(grep -E '^OPENROUTER_WORKSPACE=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- || echo macaron)"
} | ssh -o BatchMode=yes "$HOST" 'sudo install -d -m 0750 /etc/macaron && sudo tee /etc/macaron/controller.env >/dev/null && sudo chmod 0640 /etc/macaron/controller.env'
host="$(value PUBLIC_URL)"
host="${host#https://}"
printf 'MACARON_HOST=%s\nACME_EMAIL=%s\n' "${host%%/*}" "${ACME_EMAIL:-}" |
  ssh -o BatchMode=yes "$HOST" 'sudo tee /etc/macaron/caddy.env >/dev/null && sudo chmod 0640 /etc/macaron/caddy.env'
echo "   /etc/macaron/controller.env (MACARON_ENABLED=${MACARON_ENABLED:-false}), /etc/macaron/caddy.env"
