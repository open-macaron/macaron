#!/bin/sh
# Writes Bifrost's config.json from config.template.json. POSIX sh: it also runs in Bifrost's own
# (Alpine, bash-less) image. Bifrost holds no LLM key of its own: each approved endpoint becomes a
# provider at runtime, and users' keys are added to it for one run at a time (the controller's BifrostKeys).
#   [PG_SSL_MODE=require] deploy/bifrost/render-config.sh <output>
# PG_SSL_MODE (default disable, for dev.sh's local Postgres) is the Postgres connection's sslmode:
# OpenShift's Postgres only accepts TLS.
set -eu

OUT="${1:?usage: render-config.sh <output>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SSL_MODE="${PG_SSL_MODE:-disable}"
case "$SSL_MODE" in disable | require | verify-ca | verify-full) ;; *) echo "PG_SSL_MODE must be disable, require, verify-ca or verify-full" >&2; exit 1 ;; esac
tmp="$(mktemp "$OUT.XXXXXX")"
sed -e "s|\"ssl_mode\": \"disable\"|\"ssl_mode\": \"$SSL_MODE\"|" "$HERE/config.template.json" >"$tmp"
chmod 0644 "$tmp"
mv "$tmp" "$OUT"
