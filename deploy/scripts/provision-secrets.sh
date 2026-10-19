#!/usr/bin/env bash
# Creates the controller's Podman secrets and settings ON THE VPS, from a local env file.
# Run from a developer machine; every remote action goes through ssh, values never hit the
# terminal or the remote shell history (they travel on stdin):
#   deploy/scripts/provision-secrets.sh [ssh-host] [env-file]
# Re-running replaces the GitHub/OpenRouter/LLM-upstream/webhook secrets; the database passwords and
# Bifrost's admin password and encryption key are created once and never rotated by this script
# (the databases were initialised with them; Bifrost can't change its encryption key).
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

has() { grep -qE "^$1=." "$ENV_FILE"; }

echo "==> secrets on $HOST"
remote_secret macaron-gh-interact GH_INTERACT
remote_secret macaron-gh-push GH_PUSH
remote_secret macaron-gh-org GH_ORG
remote_secret macaron-or-provisioning OPENROUTER_PROVISIONING_KEY
remote_secret macaron-or-router OPENROUTER_ROUTER_KEY
remote_secret macaron-webhook-hmac WEBHOOK_HMAC
# The upstream LLM key and its URL, kept out of the public repository: their presence on the VPS is
# what turns Bifrost on (deploy.sh).
if has LLM_UPSTREAM_KEY; then
  remote_secret macaron-llm-upstream-url LLM_UPSTREAM_URL
  remote_secret macaron-llm-upstream-key LLM_UPSTREAM_KEY
fi

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
# Bifrost's: generated even while it isn't enabled, because the controller mounts the admin password.
for secret in macaron-bifrost-admin macaron-bifrost-db-password macaron-bifrost-encryption-key; do
  if ! podman secret exists "$secret"; then
    openssl rand -hex 24 | tr -d '\n' | podman secret create "$secret" - >/dev/null
    echo "   $secret (generated)"
  else
    echo "   $secret (kept)"
  fi
done
REMOTE

echo "==> settings on $HOST"
BIFROST=false
if ssh -o BatchMode=yes "$HOST" "sudo podman secret exists macaron-llm-upstream-key"; then BIFROST=true; fi
# The LLM backend keeps its current value on the VPS unless LLM_BACKEND is given explicitly.
if [[ -z "${LLM_BACKEND:-}" ]]; then
  LLM_BACKEND="$(ssh -o BatchMode=yes "$HOST" "sudo sed -n 's/^LLM_BACKEND=//p' /etc/macaron/controller.env 2>/dev/null" || true)"
  LLM_BACKEND="${LLM_BACKEND:-openrouter}"
fi
[[ "$LLM_BACKEND" != bifrost || "$BIFROST" == true ]] || { echo "LLM_BACKEND=bifrost needs LLM_UPSTREAM_KEY in $ENV_FILE" >&2; exit 1; }
# The kill switch keeps its current value on the VPS unless MACARON_ENABLED is given explicitly;
# a fresh host starts disabled.
if [[ -z "${MACARON_ENABLED:-}" ]]; then
  MACARON_ENABLED="$(ssh -o BatchMode=yes "$HOST" "sudo sed -n 's/^MACARON_ENABLED=//p' /etc/macaron/controller.env 2>/dev/null" || true)"
  MACARON_ENABLED="${MACARON_ENABLED:-false}"
fi
# Same for the operator's user-id allowlist (empty = no restriction beyond config/).
if [[ -z "${MACARON_ALLOWED_USER_IDS+set}" ]]; then
  MACARON_ALLOWED_USER_IDS="$(ssh -o BatchMode=yes "$HOST" "sudo sed -n 's/^MACARON_ALLOWED_USER_IDS=//p' /etc/macaron/controller.env 2>/dev/null" || true)"
fi
{
  printf 'PUBLIC_URL=%s\n' "$(value PUBLIC_URL)"
  printf 'MACARON_ENABLED=%s\n' "$MACARON_ENABLED"
  if [[ -n "$MACARON_ALLOWED_USER_IDS" ]]; then printf 'MACARON_ALLOWED_USER_IDS=%s\n' "$MACARON_ALLOWED_USER_IDS"; fi
  printf 'LOG_LEVEL=%s\n' "${LOG_LEVEL:-info}"
  printf 'RUNNER_REPO_ID=%s\n' "$(value RUNNER_REPO_ID)"
  printf 'RUNNER_OWNER_ID=%s\n' "$(value RUNNER_OWNER_ID)"
  printf 'OPENROUTER_WORKSPACE=%s\n' "$(grep -E '^OPENROUTER_WORKSPACE=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- || echo macaron)"
  printf 'LLM_BACKEND=%s\n' "$LLM_BACKEND"
  if [[ "$BIFROST" == true ]]; then
    printf 'BIFROST_ADMIN_URL=http://macaron-bifrost:8080\n'
    printf 'BIFROST_PUBLIC_URL=%s/llm/anthropic\n' "$(value PUBLIC_URL)"
  fi
} | ssh -o BatchMode=yes "$HOST" 'sudo install -d -m 0750 /etc/macaron && sudo tee /etc/macaron/controller.env >/dev/null && sudo chmod 0640 /etc/macaron/controller.env'
host="$(value PUBLIC_URL)"
host="${host#https://}"
printf 'MACARON_HOST=%s\nACME_EMAIL=%s\n' "${host%%/*}" "${ACME_EMAIL:-}" |
  ssh -o BatchMode=yes "$HOST" 'sudo tee /etc/macaron/caddy.env >/dev/null && sudo chmod 0640 /etc/macaron/caddy.env'
echo "   /etc/macaron/controller.env (MACARON_ENABLED=${MACARON_ENABLED}, MACARON_ALLOWED_USER_IDS=${MACARON_ALLOWED_USER_IDS:-unrestricted}, LLM_BACKEND=${LLM_BACKEND}, Bifrost ${BIFROST}), /etc/macaron/caddy.env"
echo "   restart the controller to apply: ssh $HOST sudo systemctl restart macaron-controller"
