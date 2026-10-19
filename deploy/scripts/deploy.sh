#!/usr/bin/env bash
# Deploys open-macaron/macaron@main on the VPS (docs/DEPLOYMENT.md). Run ON THE VPS as root:
#   sudo bash /opt/macaron/repo/deploy/scripts/deploy.sh
# Pull-based: the VPS fetches the public repository; GitHub never holds a credential to this host.
#
# Everything runs inside main(), which bash parses whole before running: checking out main replaces
# this file, and bash would otherwise read the rest of the new file from the old one's offset. After
# the checkout the script re-executes itself, so the deployed commit's own deploy logic runs.
set -euo pipefail

REPO_URL="https://github.com/open-macaron/macaron.git"
REPO_DIR="/opt/macaron/repo"
QUADLET_DIR="/etc/containers/systemd"
ETC_DIR="/etc/macaron"
BACKUP_DIR="/var/backups/macaron"
# The last commit whose deploy passed the health gate: what "changed" compares against, so a deploy
# that failed half-way still restarts everything that changed since.
DEPLOYED_FILE="$ETC_DIR/deployed-commit"
SECRETS=(macaron-pg-password macaron-database-url macaron-gh-interact macaron-gh-push macaron-gh-org macaron-webhook-hmac
  macaron-bifrost-admin macaron-bifrost-db-password macaron-bifrost-encryption-key)

log() { printf '\033[1m==> %s\033[0m\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }

install_quadlets() {
  install -d -m 0755 "$QUADLET_DIR"
  rm -f "$QUADLET_DIR"/macaron-*
  install -m 0644 "$REPO_DIR"/deploy/quadlets/macaron-* "$QUADLET_DIR"/
  if [[ "$BIFROST" != true ]]; then rm -f "$QUADLET_DIR"/macaron-bifrost.container; fi
  systemctl daemon-reload
}

changed() { git -C "$REPO_DIR" diff --quiet "$previous" "$current" -- "$@" && return 1 || return 0; }

# Files besides its quadlet whose change restarts a unit.
unit_files() {
  case "$1" in
    macaron-caddy) echo deploy/caddy ;;
    macaron-bifrost) echo deploy/bifrost ;;
  esac
}

# Bifrost's database and role in the shared Postgres. Idempotent; the password travels on stdin.
# The macaron role is the image's superuser and keeps access; PUBLIC loses CONNECT on both databases
# so the bifrost role can't open macaron's.
ensure_bifrost_database() {
  local password
  password="$(podman secret inspect --showsecret --format '{{.SecretData}}' macaron-bifrost-db-password)"
  [[ "$password" =~ ^[0-9a-f]+$ ]] || die "unexpected macaron-bifrost-db-password format"
  podman exec -i macaron-postgres psql -q -v ON_ERROR_STOP=1 -U macaron -d macaron >/dev/null <<SQL
SELECT 'CREATE ROLE bifrost LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bifrost')\gexec
ALTER ROLE bifrost WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '$password';
SELECT 'CREATE DATABASE bifrost OWNER bifrost' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'bifrost')\gexec
REVOKE CONNECT ON DATABASE macaron FROM PUBLIC;
REVOKE CONNECT ON DATABASE bifrost FROM PUBLIC;
GRANT CONNECT ON DATABASE bifrost TO bifrost;
SQL
}

# config.json from the repository's template and the upstream's URL (a secret). Returns 0 when it changed.
render_bifrost_config() {
  local out="$ETC_DIR/bifrost-config.json" before=""
  [[ -f "$out" ]] && before="$(sha256sum "$out")"
  podman secret inspect --showsecret --format '{{.SecretData}}' macaron-llm-upstream-url | bash "$REPO_DIR/deploy/bifrost/render-config.sh" "$out"
  [[ "$(sha256sum "$out")" != "$before" ]]
}

# Bifrost keeps spend in memory and writes it to Postgres every 10 s: restarting it while a run is
# unsettled could lose some of that run's cost.
unsettled_runs() {
  podman exec macaron-postgres psql -tA -U macaron -d macaron -c "SELECT count(*) FROM runs WHERE settled_at IS NULL"
}

# Starts what isn't running, restarts what changed. Returns 1 as soon as a unit fails to (re)start.
start_units() {
  local unit config_changed unsettled
  for unit in "${UNITS[@]}"; do
    config_changed=false
    if [[ "$unit" == macaron-bifrost ]]; then
      ensure_bifrost_database
      if render_bifrost_config; then config_changed=true; fi
    fi
    # shellcheck disable=SC2046 # unit_files prints zero or one path
    if ! systemctl is-active --quiet "$unit"; then
      # restart, not start: a unit crash-looping on its old definition would otherwise keep it.
      systemctl restart "$unit" || return 1
    elif [[ "$config_changed" == true ]] || changed "deploy/quadlets/$unit.container" $(unit_files "$unit"); then
      if [[ "$unit" == macaron-bifrost ]]; then
        unsettled="$(unsettled_runs)" || die "could not count unsettled runs"
        [[ "$unsettled" =~ ^[0-9]+$ ]] || die "could not count unsettled runs (got: $unsettled)"
        if [[ "$unsettled" != 0 ]]; then
          echo "   macaron-bifrost changed but runs are unsettled: not restarted, deploy again once they are" >&2
          continue
        fi
      fi
      systemctl restart "$unit" || return 1
    fi
  done
  if changed config && ! changed deploy/quadlets/macaron-controller.container; then
    systemctl reload macaron-controller || return 1
  fi
}

healthy() {
  local unit
  for unit in "${UNITS[@]}"; do systemctl is-active --quiet "$unit" || return 1; done
}

rollback() {
  echo "$1: rolling back to ${previous:0:7}" >&2
  git -C "$REPO_DIR" checkout --quiet --detach "$previous"
  install_quadlets
  systemctl restart macaron-controller macaron-caddy
  exit 1
}

main() {
  [[ $EUID -eq 0 ]] || die "run as root (sudo)"
  [[ "$(hostname)" == vps-* ]] || die "refusing to run outside the VPS (hostname $(hostname))"
  command -v git >/dev/null || die "git is missing (bootstrap-host.sh installs it)"

  log "prerequisites"
  [[ -f "$ETC_DIR/controller.env" ]] || die "$ETC_DIR/controller.env is missing (see provision-secrets.sh)"
  [[ -f "$ETC_DIR/caddy.env" ]] || die "$ETC_DIR/caddy.env is missing (see provision-secrets.sh)"
  local secret
  for secret in "${SECRETS[@]}"; do
    podman secret exists "$secret" || die "podman secret $secret is missing (see provision-secrets.sh)"
  done
  # Bifrost runs only once the upstream LLM key is provisioned.
  if podman secret exists macaron-llm-upstream-key && podman secret exists macaron-llm-upstream-url; then
    BIFROST=true
    UNITS=(macaron-postgres macaron-bifrost macaron-controller macaron-caddy)
  else
    BIFROST=false
    UNITS=(macaron-postgres macaron-controller macaron-caddy)
  fi
  echo "   Bifrost: $BIFROST"

  log "fetch main"
  if [[ ! -d "$REPO_DIR/.git" ]]; then
    install -d -m 0755 "$(dirname "$REPO_DIR")"
    git clone --quiet "$REPO_URL" "$REPO_DIR"
  fi
  if [[ -n "${MACARON_DEPLOY_PREVIOUS:-}" ]]; then
    previous="$MACARON_DEPLOY_PREVIOUS"
  elif [[ -s "$DEPLOYED_FILE" ]]; then
    previous="$(<"$DEPLOYED_FILE")"
  else
    previous="$(git -C "$REPO_DIR" rev-parse HEAD)"
  fi
  if [[ -z "${MACARON_DEPLOY_PREVIOUS:-}" ]]; then
    git -C "$REPO_DIR" fetch --quiet origin main
    git -C "$REPO_DIR" merge-base --is-ancestor "$previous" origin/main || die "origin/main is not a fast-forward of the deployed commit"
    git -C "$REPO_DIR" checkout --quiet --detach origin/main
    # Continue in the version just checked out (see the header).
    exec env MACARON_DEPLOY_PREVIOUS="$previous" bash "$REPO_DIR/deploy/scripts/deploy.sh"
  fi
  current="$(git -C "$REPO_DIR" rev-parse HEAD)"
  echo "   ${previous:0:7} → ${current:0:7}"

  local image
  image="$(sed -n 's/^Image=//p' "$REPO_DIR/deploy/quadlets/macaron-controller.container")"
  [[ "$image" =~ @sha256:[0-9a-f]{64}$ ]] || die "controller image is not pinned by digest: $image"
  [[ "$image" != *@sha256:0000000000000000000000000000000000000000000000000000000000000000 ]] || die "controller image digest is still the placeholder"

  if systemctl is-active --quiet macaron-postgres && changed deploy/quadlets packages; then
    log "database dump before changing the controller"
    install -d -m 0700 "$BACKUP_DIR"
    podman exec macaron-postgres pg_dump -U macaron -d macaron | gzip >"$BACKUP_DIR/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ)-${previous:0:7}.sql.gz"
    find "$BACKUP_DIR" -name 'pre-deploy-*.sql.gz' -mtime +30 -delete
  fi

  log "install quadlets"
  install_quadlets

  log "start or restart"
  start_units || rollback "a unit failed to start"

  log "health gate"
  local _
  for _ in $(seq 1 24); do
    if healthy; then
      printf '%s\n' "$current" >"$DEPLOYED_FILE"
      echo "   healthy on ${current:0:7}"
      return 0
    fi
    sleep 5
  done
  rollback "not healthy after 2 minutes"
}

main "$@"
exit
