#!/usr/bin/env bash
# Creates the Secrets and the settings ConfigMap of macaron-bot on OpenShift, from a local env file.
# Run from a developer machine logged in with oc, after a first deploy.sh (PUBLIC_URL is the Route's):
#   MACARON_NAMESPACE=<namespace> deploy/openshift/scripts/provision-secrets.sh [env-file]
# Values never reach the terminal or a command line: they travel through pipes (process substitution)
# into `oc create secret --dry-run`, then a server-side apply (no last-applied annotation copying them).
# One Secret per workload, holding only what that workload reads.
#
# Re-running replaces the GitHub, webhook and LLM-upstream values. Generated once, then kept: the
# database passwords, and Bifrost's admin password and encryption key, which are copied from the VPS
# (Bifrost can't change its encryption key, and the VPS's database is restored here) unless
# GENERATE_BIFROST_KEYS=1. Settings keep their current values unless given in the environment
# (MACARON_ENABLED, MACARON_ALLOWED_USER_IDS, LOG_LEVEL); a fresh namespace starts disabled.
set -euo pipefail

NS="${MACARON_NAMESPACE:?set MACARON_NAMESPACE to the target namespace}"
ENV_FILE="${1:-$HOME/.config/macaron/dev.env}"
VPS_HOST="${VPS_HOST:-open-macaron-vps}"
[[ -r "$ENV_FILE" ]] || { echo "cannot read $ENV_FILE" >&2; exit 1; }

oc() { command oc --namespace "$NS" "$@"; }

value() {
  local line
  line="$(grep -E "^$1=" "$ENV_FILE" | tail -n 1)" || true
  [[ -n "$line" ]] || { echo "$1 is not set in $ENV_FILE" >&2; exit 1; }
  printf '%s' "${line#*=}"
}

# A key of an existing Secret, or nothing.
current() { { oc get secret "$1" -o "jsonpath={.data.$2}" 2>/dev/null || true; } | base64 -d; }

# name, then key=file pairs (process substitutions).
apply_secret() {
  local name="$1"
  shift
  oc create secret generic "$name" --dry-run=client -o yaml "${@/#/--from-file=}" |
    oc label --local -f - -o yaml app.kubernetes.io/part-of=macaron |
    oc apply --server-side --field-manager=macaron-provision --force-conflicts -f - >/dev/null
  echo "   secret/$name"
}

vps_secret() { ssh -o BatchMode=yes "$VPS_HOST" "sudo podman secret inspect --showsecret --format '{{.SecretData}}' $1"; }

command oc whoami >/dev/null || { echo "log in with oc first" >&2; exit 1; }
host="$(oc get route macaron -o jsonpath='{.spec.host}' 2>/dev/null)" || true
[[ -n "$host" ]] || { echo "route/macaron is missing in $NS: run deploy/openshift/scripts/deploy.sh first" >&2; exit 1; }
PUBLIC_URL="https://$host"

echo "==> secrets in $NS"
macaron_password="$(current macaron-postgres macaron-password)"
bifrost_db_password="$(current macaron-postgres bifrost-password)"
[[ -n "$macaron_password" ]] || macaron_password="$(openssl rand -hex 24)"
[[ -n "$bifrost_db_password" ]] || bifrost_db_password="$(openssl rand -hex 24)"

bifrost_admin="$(current macaron-bifrost admin-password)"
encryption_key="$(current macaron-bifrost encryption-key)"
if [[ -z "$encryption_key" ]]; then
  if [[ "${GENERATE_BIFROST_KEYS:-}" == 1 ]]; then
    bifrost_admin="$(openssl rand -hex 24)"
    encryption_key="$(openssl rand -hex 24)"
  else
    bifrost_admin="$(vps_secret macaron-bifrost-admin)"
    encryption_key="$(vps_secret macaron-bifrost-encryption-key)"
    echo "   Bifrost admin password and encryption key copied from $VPS_HOST"
  fi
fi
[[ "$bifrost_admin" =~ ^[0-9a-f]{48}$ && "$encryption_key" =~ ^[0-9a-f]{48}$ ]] || { echo "unexpected Bifrost key format" >&2; exit 1; }

apply_secret macaron-postgres \
  macaron-password=<(printf %s "$macaron_password") \
  bifrost-password=<(printf %s "$bifrost_db_password")
apply_secret macaron-backup \
  macaron-password=<(printf %s "$macaron_password") \
  bifrost-password=<(printf %s "$bifrost_db_password")
apply_secret macaron-controller \
  database-password=<(printf %s "$macaron_password") \
  gh-interact=<(value GH_INTERACT) \
  gh-push=<(value GH_PUSH) \
  gh-org=<(value GH_ORG) \
  webhook-hmac=<(value WEBHOOK_HMAC) \
  bifrost-admin-password=<(printf %s "$bifrost_admin")
apply_secret macaron-bifrost \
  llm-upstream-url=<(value LLM_UPSTREAM_URL) \
  llm-upstream-key=<(value LLM_UPSTREAM_KEY) \
  admin-password=<(printf %s "$bifrost_admin") \
  db-password=<(printf %s "$bifrost_db_password") \
  encryption-key=<(printf %s "$encryption_key")

echo "==> settings in $NS"
setting() { oc get configmap macaron-settings -o "jsonpath={.data.$1}" 2>/dev/null || true; }
MACARON_ENABLED="${MACARON_ENABLED:-$(setting MACARON_ENABLED)}"
MACARON_ENABLED="${MACARON_ENABLED:-false}"
[[ "$MACARON_ENABLED" == true || "$MACARON_ENABLED" == false ]] || { echo "MACARON_ENABLED must be true or false" >&2; exit 1; }
if [[ -z "${MACARON_ALLOWED_USER_IDS+set}" ]]; then
  if oc get configmap macaron-settings >/dev/null 2>&1; then
    MACARON_ALLOWED_USER_IDS="$(setting MACARON_ALLOWED_USER_IDS)"
  else
    # A fresh namespace inherits the VPS's allowlist rather than starting unrestricted.
    MACARON_ALLOWED_USER_IDS="$(ssh -o BatchMode=yes "$VPS_HOST" "sudo sed -n 's/^MACARON_ALLOWED_USER_IDS=//p' /etc/macaron/controller.env")"
  fi
fi
[[ -z "$MACARON_ALLOWED_USER_IDS" || "$MACARON_ALLOWED_USER_IDS" =~ ^[0-9]+(,[0-9]+)*$ ]] || { echo "MACARON_ALLOWED_USER_IDS must be comma-separated numeric ids" >&2; exit 1; }
LOG_LEVEL="${LOG_LEVEL:-$(setting LOG_LEVEL)}"
settings=(
  --from-literal=PUBLIC_URL="$PUBLIC_URL"
  --from-literal=MACARON_ENABLED="$MACARON_ENABLED"
  --from-literal=LOG_LEVEL="${LOG_LEVEL:-info}"
  --from-literal=RUNNER_REPO_ID="$(value RUNNER_REPO_ID)"
  --from-literal=RUNNER_OWNER_ID="$(value RUNNER_OWNER_ID)"
  --from-literal=LLM_BACKEND=bifrost
  --from-literal=BIFROST_PUBLIC_URL="$PUBLIC_URL/llm/anthropic"
)
if [[ -n "$MACARON_ALLOWED_USER_IDS" ]]; then settings+=(--from-literal=MACARON_ALLOWED_USER_IDS="$MACARON_ALLOWED_USER_IDS"); fi
oc create configmap macaron-settings --dry-run=client -o yaml "${settings[@]}" |
  oc label --local -f - -o yaml app.kubernetes.io/part-of=macaron |
  oc apply --server-side --field-manager=macaron-provision --force-conflicts -f - >/dev/null
echo "   configmap/macaron-settings (PUBLIC_URL=$PUBLIC_URL, MACARON_ENABLED=$MACARON_ENABLED, MACARON_ALLOWED_USER_IDS=${MACARON_ALLOWED_USER_IDS:-unrestricted})"
echo "   running pods keep their old values: oc -n $NS rollout restart deployment/macaron-controller deployment/macaron-bifrost"
