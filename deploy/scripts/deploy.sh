#!/usr/bin/env bash
# Deploys open-macaron/macaron@main on the VPS (docs/DEPLOYMENT.md). Run ON THE VPS as root:
#   sudo bash /opt/macaron/repo/deploy/scripts/deploy.sh
# Pull-based: the VPS fetches the public repository; GitHub never holds a credential to this host.
set -euo pipefail

REPO_URL="https://github.com/open-macaron/macaron.git"
REPO_DIR="/opt/macaron/repo"
QUADLET_DIR="/etc/containers/systemd"
ETC_DIR="/etc/macaron"
BACKUP_DIR="/var/backups/macaron"
SECRETS=(macaron-pg-password macaron-database-url macaron-gh-interact macaron-gh-push macaron-gh-org macaron-or-provisioning macaron-or-router macaron-webhook-hmac)
UNITS=(macaron-postgres macaron-controller macaron-caddy)

log() { printf '\033[1m==> %s\033[0m\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "run as root (sudo)"
[[ "$(hostname)" == vps-* ]] || die "refusing to run outside the VPS (hostname $(hostname))"
command -v git >/dev/null || die "git is missing (bootstrap-host.sh installs it)"

log "prerequisites"
[[ -f "$ETC_DIR/controller.env" ]] || die "$ETC_DIR/controller.env is missing (see provision-secrets.sh)"
[[ -f "$ETC_DIR/caddy.env" ]] || die "$ETC_DIR/caddy.env is missing (see provision-secrets.sh)"
for secret in "${SECRETS[@]}"; do
  podman secret exists "$secret" || die "podman secret $secret is missing (see provision-secrets.sh)"
done

log "fetch main"
if [[ ! -d "$REPO_DIR/.git" ]]; then
  install -d -m 0755 "$(dirname "$REPO_DIR")"
  git clone --quiet "$REPO_URL" "$REPO_DIR"
fi
previous="$(git -C "$REPO_DIR" rev-parse HEAD)"
git -C "$REPO_DIR" fetch --quiet origin main
git -C "$REPO_DIR" merge-base --is-ancestor "$previous" origin/main || die "origin/main is not a fast-forward of the deployed commit"
git -C "$REPO_DIR" checkout --quiet --detach origin/main
current="$(git -C "$REPO_DIR" rev-parse HEAD)"
echo "   ${previous:0:7} → ${current:0:7}"

image="$(sed -n 's/^Image=//p' "$REPO_DIR/deploy/quadlets/macaron-controller.container")"
[[ "$image" =~ @sha256:[0-9a-f]{64}$ ]] || die "controller image is not pinned by digest: $image"
[[ "$image" != *@sha256:0000000000000000000000000000000000000000000000000000000000000000 ]] || die "controller image digest is still the placeholder"

install_quadlets() {
  install -d -m 0755 "$QUADLET_DIR"
  rm -f "$QUADLET_DIR"/macaron-*
  install -m 0644 "$REPO_DIR"/deploy/quadlets/macaron-* "$QUADLET_DIR"/
  systemctl daemon-reload
}

changed() { git -C "$REPO_DIR" diff --quiet "$previous" "$current" -- "$@" && return 1 || return 0; }

if systemctl is-active --quiet macaron-postgres && changed deploy/quadlets packages; then
  log "database dump before changing the controller"
  install -d -m 0700 "$BACKUP_DIR"
  podman exec macaron-postgres pg_dump -U macaron -d macaron | gzip >"$BACKUP_DIR/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ)-${previous:0:7}.sql.gz"
  find "$BACKUP_DIR" -name 'pre-deploy-*.sql.gz' -mtime +30 -delete
fi

log "install quadlets"
install_quadlets

log "start or restart"
for unit in "${UNITS[@]}"; do
  if ! systemctl is-active --quiet "$unit"; then
    systemctl start "$unit"
  elif changed "deploy/quadlets/$unit.container" "deploy/caddy"; then
    systemctl restart "$unit"
  fi
done
if changed config && ! changed deploy/quadlets/macaron-controller.container; then
  systemctl reload macaron-controller
fi

log "health gate"
for _ in $(seq 1 24); do
  if systemctl is-active --quiet macaron-controller; then
    echo "   controller healthy on ${current:0:7}"
    exit 0
  fi
  sleep 5
done

echo "controller not healthy after 2 minutes: rolling back to ${previous:0:7}" >&2
git -C "$REPO_DIR" checkout --quiet --detach "$previous"
install_quadlets
systemctl restart macaron-controller macaron-caddy
exit 1
