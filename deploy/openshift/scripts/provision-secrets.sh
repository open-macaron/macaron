#!/usr/bin/env bash
# Creates the Secrets and the settings ConfigMap of macaron-bot on OpenShift, from a local env file.
# Run from a developer machine logged in with oc, after a first deploy.sh (PUBLIC_URL is the Route's):
#   MACARON_NAMESPACE=<namespace> deploy/openshift/scripts/provision-secrets.sh [env-file]
# Values never reach the terminal or a command line: they travel through pipes (process substitution)
# into `oc create secret --dry-run`, then a server-side apply (no last-applied annotation copying them).
# One Secret per workload, holding only what that workload reads.
#
# Re-running replaces the GitHub, webhook and LLM-upstream values. Generated once, then kept: the
# database passwords, and Bifrost's admin password and encryption key (Bifrost can't change its
# encryption key: keep a copy outside the cluster, docs/DEPLOYMENT.md §4). Settings keep their current
# values unless given in the environment (MACARON_ENABLED, LOG_LEVEL, CONFIG_URL, CONFIG_REPO_ID,
# MACARON_ADMIN_USER_IDS and LLM_ENDPOINT_DEFAULTS); a fresh namespace starts disabled. Who may trigger the bot is an account
# of the web app (invited, with capabilities): without sign-in configured, nobody can.
#
# Users' LLM keys are sealed under key-encryption keys in the Secret macaron-llm-kek (files v1, v2…),
# generated once, then kept. LLM_KEK_ROTATE=1 adds a version (then restart the controller and run
# `node dist/rotate-llm-keys.js` in it); LLM_KEK_RETIRE=<n> removes version n once nothing uses it.
#
# Sign-in (the web app) is configured when the env file has the org GitHub App's
# GITHUB_LOGIN_CLIENT_ID and GITHUB_LOGIN_CLIENT_SECRET, and MACARON_ADMIN_USER_IDS is known; the
# session-signing secret is generated once, then kept (changing it signs everyone out).
set -euo pipefail

NS="${MACARON_NAMESPACE:?set MACARON_NAMESPACE to the target namespace}"
ENV_FILE="${1:-$HOME/.config/macaron/dev.env}"
[[ -r "$ENV_FILE" ]] || { echo "cannot read $ENV_FILE" >&2; exit 1; }

oc() { command oc --namespace "$NS" "$@"; }

value() {
  local line
  line="$(grep -E "^$1=" "$ENV_FILE" | tail -n 1)" || true
  [[ -n "$line" ]] || { echo "$1 is not set in $ENV_FILE" >&2; exit 1; }
  printf '%s' "${line#*=}"
}

# A variable of the env file, or nothing when it isn't there.
optional_value() {
  local line
  line="$(grep -E "^$1=" "$ENV_FILE" | tail -n 1)" || true
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
  bifrost_admin="$(openssl rand -hex 24)"
  encryption_key="$(openssl rand -hex 24)"
  echo "   Bifrost admin password and encryption key generated: copy the encryption key outside the cluster"
fi
[[ "$bifrost_admin" =~ ^[0-9a-f]{48}$ && "$encryption_key" =~ ^[0-9a-f]{48}$ ]] || { echo "unexpected Bifrost key format" >&2; exit 1; }

apply_secret macaron-postgres \
  macaron-password=<(printf %s "$macaron_password") \
  bifrost-password=<(printf %s "$bifrost_db_password")
apply_secret macaron-backup \
  macaron-password=<(printf %s "$macaron_password") \
  bifrost-password=<(printf %s "$bifrost_db_password")
login_client_id="$(optional_value GITHUB_LOGIN_CLIENT_ID)"
login_client_secret="$(optional_value GITHUB_LOGIN_CLIENT_SECRET)"
# Process substitutions go straight to apply_secret (stored in a variable, their pipes would be closed by then).
if [[ -n "$login_client_id" && -n "$login_client_secret" ]]; then
  better_auth_secret="$(current macaron-controller better-auth-secret)"
  [[ -n "$better_auth_secret" ]] || better_auth_secret="$(openssl rand -hex 32)"
  apply_secret macaron-controller \
    database-password=<(printf %s "$macaron_password") \
    gh-interact=<(value GH_INTERACT) \
    gh-push=<(value GH_PUSH) \
    gh-org=<(value GH_ORG) \
    webhook-hmac=<(value WEBHOOK_HMAC) \
    bifrost-admin-password=<(printf %s "$bifrost_admin") \
    better-auth-secret=<(printf %s "$better_auth_secret") \
    github-login-client-secret=<(printf %s "$login_client_secret")
  echo "   sign-in: configured (GitHub App $login_client_id)"
else
  apply_secret macaron-controller \
    database-password=<(printf %s "$macaron_password") \
    gh-interact=<(value GH_INTERACT) \
    gh-push=<(value GH_PUSH) \
    gh-org=<(value GH_ORG) \
    webhook-hmac=<(value WEBHOOK_HMAC) \
    bifrost-admin-password=<(printf %s "$bifrost_admin")
  echo "   sign-in: not configured (no GITHUB_LOGIN_CLIENT_ID and GITHUB_LOGIN_CLIENT_SECRET in $ENV_FILE)"
fi
# The key-encryption keys. Losing one makes every key sealed under it unreadable, so this stops at
# the first doubt: the Secret is "absent" only on NotFound, and every existing version is read and
# checked before anything is applied.
kek_list() { oc get secret macaron-llm-kek -o go-template='{{range $k, $v := .data}}{{$k}}{{"\n"}}{{end}}'; }
declare -A keks=()
if listing="$(kek_list 2>&1)"; then
  while IFS= read -r name; do
    [[ "$name" =~ ^v([1-9][0-9]*)$ ]] || continue
    version="${BASH_REMATCH[1]}"
    value="$(oc get secret macaron-llm-kek -o "jsonpath={.data.$name}" | base64 -d)" || { echo "cannot read $name of macaron-llm-kek: stopping" >&2; exit 1; }
    [[ "$value" =~ ^[0-9a-f]{64}$ ]] || { echo "$name of macaron-llm-kek isn't 32 bytes in hex: stopping" >&2; exit 1; }
    keks["$version"]="$value"
  done <<<"$listing"
  (( ${#keks[@]} > 0 )) || { echo "macaron-llm-kek holds no version: restore it from the copy kept outside the cluster" >&2; exit 1; }
elif [[ "$listing" != *NotFound* ]]; then
  echo "cannot read secret/macaron-llm-kek: stopping, so that no key-encryption key is replaced" >&2
  exit 1
fi
newest=0
for version in "${!keks[@]}"; do if (( version > newest )); then newest="$version"; fi; done
if [[ -n "${LLM_KEK_RETIRE:-}" ]]; then
  [[ "$LLM_KEK_RETIRE" =~ ^[1-9][0-9]*$ && -n "${keks[$LLM_KEK_RETIRE]:-}" && "$LLM_KEK_RETIRE" != "$newest" ]] ||
    { echo "LLM_KEK_RETIRE must name an existing version other than the newest (v$newest)" >&2; exit 1; }
  unset "keks[$LLM_KEK_RETIRE]"
  echo "   v$LLM_KEK_RETIRE retired: rotate-llm-keys must have re-sealed every key under it first"
fi
if (( newest == 0 )) || [[ "${LLM_KEK_ROTATE:-}" == 1 ]]; then
  newest=$((newest + 1))
  keks["$newest"]="$(openssl rand -hex 32)"
  echo "   key-encryption key v$newest generated: copy it outside the cluster (docs/DEPLOYMENT.md §4)"
fi
# One `v<n>=<hex>` line per version, read through a pipe: printf is a builtin, nothing reaches a command line.
kek_env() {
  local version
  for version in "${!keks[@]}"; do printf 'v%s=%s\n' "$version" "${keks[$version]}"; done
}
oc create secret generic macaron-llm-kek --dry-run=client -o yaml --from-env-file=<(kek_env) |
  oc label --local -f - -o yaml app.kubernetes.io/part-of=macaron |
  oc apply --server-side --field-manager=macaron-provision --force-conflicts -f - >/dev/null
expected="$(for version in "${!keks[@]}"; do echo "v$version"; done | sort)"
[[ "$(kek_list | sort)" == "$expected" ]] || { echo "macaron-llm-kek doesn't hold the expected versions after the apply: check it now" >&2; exit 1; }
echo "   secret/macaron-llm-kek ($(echo "$expected" | paste -sd, -))"

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
LOG_LEVEL="${LOG_LEVEL:-$(setting LOG_LEVEL)}"
# The controller's configuration: open-macaron/config's published snapshot (docs/DEPLOYMENT.md §6,
# "Configuration"). Kept unless given; a fresh namespace gets open-macaron/config's.
CONFIG_URL="${CONFIG_URL:-$(setting CONFIG_URL)}"
CONFIG_URL="${CONFIG_URL:-https://open-macaron.github.io/config/v1}"
CONFIG_REPO_ID="${CONFIG_REPO_ID:-$(setting CONFIG_REPO_ID)}"
CONFIG_REPO_ID="${CONFIG_REPO_ID:-1429850279}" # gh api repos/open-macaron/config --jq .id
[[ "$CONFIG_URL" =~ ^https://[^[:space:]]+$ && "$CONFIG_REPO_ID" =~ ^[0-9]+$ ]] ||
  { echo "CONFIG_URL must be https and CONFIG_REPO_ID a numeric repository id" >&2; exit 1; }
settings=(
  --from-literal=PUBLIC_URL="$PUBLIC_URL"
  --from-literal=MACARON_ENABLED="$MACARON_ENABLED"
  --from-literal=LOG_LEVEL="${LOG_LEVEL:-info}"
  --from-literal=RUNNER_REPO_ID="$(value RUNNER_REPO_ID)"
  --from-literal=RUNNER_OWNER_ID="$(value RUNNER_OWNER_ID)"
  --from-literal=LLM_BACKEND=bifrost
  --from-literal=BIFROST_PUBLIC_URL="$PUBLIC_URL/llm/anthropic"
)
settings+=(--from-literal=CONFIG_URL="$CONFIG_URL" --from-literal=CONFIG_REPO_ID="$CONFIG_REPO_ID")
# The LLM endpoints approved on a fresh database, a JSON list of {name, baseUrl, pricingNote?} (no
# secret). The controller validates it at start and only ever adds what is missing: administrators
# manage endpoints from the web app afterwards. Kept unless given; none by default.
LLM_ENDPOINT_DEFAULTS="${LLM_ENDPOINT_DEFAULTS:-$(setting LLM_ENDPOINT_DEFAULTS)}"
if [[ -n "$LLM_ENDPOINT_DEFAULTS" ]]; then
  [[ "$LLM_ENDPOINT_DEFAULTS" =~ ^[[:space:]]*\[.*\][[:space:]]*$ ]] || { echo "LLM_ENDPOINT_DEFAULTS must be a JSON list" >&2; exit 1; }
  settings+=(--from-literal=LLM_ENDPOINT_DEFAULTS="$LLM_ENDPOINT_DEFAULTS")
fi
if [[ -n "$login_client_id" ]]; then
  # The admins: they sign in without an invitation and hold every capability. Kept unless given.
  MACARON_ADMIN_USER_IDS="${MACARON_ADMIN_USER_IDS:-$(setting MACARON_ADMIN_USER_IDS)}"
  [[ "$MACARON_ADMIN_USER_IDS" =~ ^[0-9]+(,[0-9]+)*$ ]] || { echo "sign-in needs MACARON_ADMIN_USER_IDS (comma-separated GitHub user ids)" >&2; exit 1; }
  settings+=(--from-literal=GITHUB_LOGIN_CLIENT_ID="$login_client_id" --from-literal=MACARON_ADMIN_USER_IDS="$MACARON_ADMIN_USER_IDS")
fi
oc create configmap macaron-settings --dry-run=client -o yaml "${settings[@]}" |
  oc label --local -f - -o yaml app.kubernetes.io/part-of=macaron |
  oc apply --server-side --field-manager=macaron-provision --force-conflicts -f - >/dev/null
echo "   configmap/macaron-settings (PUBLIC_URL=$PUBLIC_URL, MACARON_ENABLED=$MACARON_ENABLED, config: $CONFIG_URL)"
echo "   running pods keep their old values: oc -n $NS rollout restart deployment/macaron-controller deployment/macaron-bifrost"
