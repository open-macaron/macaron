#!/usr/bin/env bash
# Writes Bifrost's config.json from config.template.json with the upstream's URL, which stays out of
# this public repository (a Podman secret on the VPS, dev.env locally). The URL arrives on stdin.
#   printf %s "$url" | deploy/bifrost/render-config.sh <output>
set -euo pipefail

OUT="${1:?usage: render-config.sh <output>, URL on stdin}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
url="$(cat)"
# Strict shape: it lands in JSON and in a sed replacement.
[[ "$url" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~/-]*)?$ ]] || { echo "the LLM upstream URL must be a plain https:// URL" >&2; exit 1; }
tmp="$(mktemp "$OUT.XXXXXX")"
sed "s|__LLM_UPSTREAM_URL__|${url%/}|" "$HERE/config.template.json" >"$tmp"
chmod 0644 "$tmp"
mv "$tmp" "$OUT"
