#!/bin/sh
# Writes Bifrost's config.json from config.template.json with the upstream's URL, which stays out of
# this public repository (a Secret on OpenShift, dev.env locally). The URL arrives on stdin. POSIX sh: it also runs in Bifrost's own (Alpine, bash-less) image.
#   printf %s "$url" | [PG_SSL_MODE=require] deploy/bifrost/render-config.sh <output>
# PG_SSL_MODE (default disable, for dev.sh's local Postgres) is the Postgres connection's sslmode:
# OpenShift's Postgres only accepts TLS.
set -eu

OUT="${1:?usage: render-config.sh <output>, URL on stdin}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SSL_MODE="${PG_SSL_MODE:-disable}"
url="$(cat)"
# Strict shape: it lands in JSON and in a sed replacement.
case "$url" in *"
"*) echo "the LLM upstream URL must be a single line" >&2; exit 1 ;; esac
printf '%s' "$url" | grep -Eqx 'https://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?' || { echo "the LLM upstream URL must be a plain https:// URL" >&2; exit 1; }
case "$SSL_MODE" in disable | require | verify-ca | verify-full) ;; *) echo "PG_SSL_MODE must be disable, require, verify-ca or verify-full" >&2; exit 1 ;; esac
tmp="$(mktemp "$OUT.XXXXXX")"
sed -e "s|__LLM_UPSTREAM_URL__|${url%/}|" -e "s|\"ssl_mode\": \"disable\"|\"ssl_mode\": \"$SSL_MODE\"|" "$HERE/config.template.json" >"$tmp"
chmod 0644 "$tmp"
mv "$tmp" "$OUT"
