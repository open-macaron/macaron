#!/usr/bin/env bash
# Deploys this checkout of open-macaron/macaron to OpenShift (docs/DEPLOYMENT.md). Run from a
# developer machine logged in with oc:
#   MACARON_NAMESPACE=<namespace> deploy/openshift/scripts/deploy.sh
# GitHub never holds a credential to the cluster: the operator applies a clean checkout of main
# (MACARON_DEPLOY_UNMERGED=1 allows another commit, for a first deploy or a fix under review).
set -euo pipefail

NS="${MACARON_NAMESPACE:?set MACARON_NAMESPACE to the target namespace}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
REQUIRED=(secret/macaron-postgres secret/macaron-backup secret/macaron-controller secret/macaron-bifrost configmap/macaron-settings)
FIELD_MANAGER=macaron-deploy

log() { printf '\033[1m==> %s\033[0m\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }
oc() { command oc --namespace "$NS" "$@"; }

# config/ as a ConfigMap whose items rebuild its tree in the controller (keys can't hold "/").
config_overlay() {
  local dir="$1" file key rel
  # Kustomize takes no absolute roots.
  rel="$(realpath --relative-to="$dir" "$ROOT")"
  {
    echo "apiVersion: kustomize.config.k8s.io/v1beta1"
    echo "kind: Kustomization"
    echo "resources: [$rel/deploy/openshift]"
    echo "labels: [{pairs: {app.kubernetes.io/part-of: macaron}}]"
    echo "configMapGenerator:"
    echo "  - name: macaron-config"
    echo "    files:"
    while IFS= read -r file; do
      key="${file//\//__}"
      echo "      - $key=$rel/config/$file"
    done < <(git -C "$ROOT/config" ls-files)
    echo "patches:"
    echo "  - path: config-items.yaml"
  } >"$dir/kustomization.yaml"
  {
    echo "apiVersion: apps/v1"
    echo "kind: Deployment"
    echo "metadata: {name: macaron-controller}"
    echo "spec: {template: {spec: {volumes: [{name: config, configMap: {name: macaron-config, items: ["
    while IFS= read -r file; do
      key="${file//\//__}"
      echo "  {key: $key, path: $file},"
    done < <(git -C "$ROOT/config" ls-files)
    echo "]}}]}}}"
  } >"$dir/config-items.yaml"
}

# The generation an object would have after the apply, as the server computes it: it moves only
# when the spec changes.
next_generation() { # kind/name
  oc apply --server-side --field-manager="$FIELD_MANAGER" --force-conflicts --dry-run=server -f "$BUILD/manifests.yaml" \
    -o jsonpath='{range .items[*]}{.kind}/{.metadata.name}={.metadata.generation}{"\n"}{end}' | sed -n "s|^$1=||p"
}

# The digest the macaron-controller ImageStream holds now (importing it on a first deploy): the
# controller follows its releases through the image trigger, and a deploy applies that same digest,
# so it never moves the controller forward or back.
controller_image() {
  oc apply --server-side --field-manager="$FIELD_MANAGER" --force-conflicts -f "$ROOT/deploy/openshift/controller-imagestream.yaml" >/dev/null
  local reference="" _
  for _ in $(seq 1 60); do
    reference="$(oc get imagestream/macaron-controller -o jsonpath='{.status.tags[?(@.tag=="latest")].items[0].dockerImageReference}')"
    [[ -n "$reference" ]] && break
    sleep 2
  done
  [[ "$reference" =~ ^ghcr\.io/open-macaron/controller@sha256:[0-9a-f]{64}$ ]] ||
    die "imagestream/macaron-controller has no imported digest: $(oc get imagestream/macaron-controller -o jsonpath='{.status.tags[?(@.tag=="latest")].conditions[0].message}')"
  printf '%s' "$reference"
}

unsettled_runs() {
  oc exec statefulset/macaron-postgres -c postgres -- psql -tA -d macaron -c "SELECT count(*) FROM runs WHERE settled_at IS NULL"
}

main() {
  command oc whoami >/dev/null || die "log in with oc first"
  command -v git >/dev/null || die "git is missing"

  log "checkout"
  git -C "$ROOT" diff --quiet HEAD && git -C "$ROOT" diff --cached --quiet && [[ -z "$(git -C "$ROOT" ls-files --others --exclude-standard)" ]] ||
    die "the checkout has uncommitted changes: deploy a commit"
  local commit
  commit="$(git -C "$ROOT" rev-parse HEAD)"
  git -C "$ROOT" fetch --quiet origin main
  if [[ "$commit" != "$(git -C "$ROOT" rev-parse origin/main)" ]]; then
    [[ "${MACARON_DEPLOY_UNMERGED:-}" == 1 ]] || die "HEAD ${commit:0:7} is not origin/main (MACARON_DEPLOY_UNMERGED=1 to deploy it anyway)"
    echo "   ${commit:0:7} is not origin/main (MACARON_DEPLOY_UNMERGED=1)"
  fi
  echo "   ${commit:0:7} → $NS"

  BUILD="$(mktemp -d)"
  trap 'rm -rf "$BUILD"' EXIT
  config_overlay "$BUILD"
  command oc kustomize --load-restrictor LoadRestrictionsNone "$BUILD" >"$BUILD/manifests.yaml"
  local image
  image="$(controller_image)"
  echo "   controller: ${image#*@}"
  sed -i "s|image: ghcr.io/open-macaron/controller:latest$|image: ${image}|" "$BUILD/manifests.yaml"
  grep -Eq 'image: ghcr.io/open-macaron/controller@sha256:[0-9a-f]{64}$' "$BUILD/manifests.yaml" || die "controller image is not pinned by digest"
  ! grep -q '@sha256:0000000000000000000000000000000000000000000000000000000000000000' "$BUILD/manifests.yaml" || die "an image digest is still the placeholder"

  log "prerequisites"
  local missing=() object
  for object in "${REQUIRED[@]}"; do oc get "$object" >/dev/null 2>&1 || missing+=("$object"); done

  if oc get statefulset/macaron-postgres >/dev/null 2>&1 && [[ "$(oc get statefulset/macaron-postgres -o jsonpath='{.status.readyReplicas}')" == 1 ]]; then
    # Bifrost keeps spend in memory and writes it to Postgres every 10 s: restarting it while a run is
    # unsettled could lose some of that run's cost.
    if oc get deployment/macaron-bifrost >/dev/null 2>&1 &&
      [[ "$(next_generation Deployment/macaron-bifrost)" != "$(oc get deployment/macaron-bifrost -o jsonpath='{.metadata.generation}')" ]]; then
      local unsettled
      unsettled="$(unsettled_runs)" || die "could not count unsettled runs"
      [[ "$unsettled" =~ ^[0-9]+$ ]] || die "could not count unsettled runs (got: $unsettled)"
      [[ "$unsettled" == 0 ]] || die "Bifrost would restart but $unsettled run(s) are unsettled: deploy again once they are"
    fi

    log "database dump before deploying"
    local job
    job="macaron-pg-dump-predeploy-$(date -u +%Y%m%d%H%M%S)"
    oc create job "$job" --from=cronjob/macaron-pg-dump >/dev/null
    oc wait --for=condition=complete --timeout=10m "job/$job" >/dev/null || die "the pre-deploy dump failed: oc -n $NS logs job/$job"
    oc logs "job/$job" | sed 's/^/   /'
  fi

  log "apply"
  oc apply --server-side --field-manager="$FIELD_MANAGER" --force-conflicts -f "$BUILD/manifests.yaml" | sed 's/^/   /'

  if ((${#missing[@]})); then
    echo "   missing ${missing[*]}: run deploy/openshift/scripts/provision-secrets.sh, then this script again" >&2
    exit 1
  fi

  log "rollout"
  local failed=()
  oc rollout status statefulset/macaron-postgres --timeout=5m || failed+=(statefulset/macaron-postgres)
  for object in deployment/macaron-bifrost deployment/macaron-controller deployment/macaron-edge; do
    oc rollout status "$object" --timeout=5m || failed+=("$object")
  done
  if ((${#failed[@]})); then
    for object in "${failed[@]}"; do
      [[ "$object" == deployment/* ]] && oc rollout undo "$object" >/dev/null && echo "   rolled back $object" >&2
    done
    die "not healthy: ${failed[*]}"
  fi
  echo "   healthy on ${commit:0:7}: https://$(oc get route macaron -o jsonpath='{.spec.host}')"
}

main "$@"
