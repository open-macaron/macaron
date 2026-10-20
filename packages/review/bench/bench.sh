#!/usr/bin/env bash
# Benchmarks a review engine (a macaron-review bundle) on real pull requests, through the local
# Bifrost (deploy/bifrost/dev.sh up) with the production key settings, so every request a review
# makes is logged with its status and cost.
#
#   packages/review/bench/bench.sh <engine.mjs> <label> <git checkout> <cases.tsv> <runs> [results.jsonl]
#
# cases.tsv, one case per line (# comments allowed); both commits must be in the checkout:
#   name <TAB> base sha <TAB> head sha <TAB> knowledge project <TAB> repo
# Each run gets its own virtual key (budget BENCH_BUDGET_USD, default 5; BENCH_RPM requests a
# minute, default 60 as in production), a fresh Claude Code config, and the runner's environment.
# One JSON line per run goes to stdout and to the results file (default bench-results.jsonl);
# BENCH_LOGS=<dir> also keeps each run's events and stderr.
#
# Needs: claude on PATH (pin it like the runner: 2.1.296), BIFROST_ADMIN_PASSWORD in
# ~/.config/macaron/dev.env (read here, never printed), node, jq, podman.
set -euo pipefail

ENGINE="$(realpath "${1:?engine bundle}")"; LABEL="${2:?label}"; CHECKOUT="${3:?git checkout}"; CASES="${4:?cases.tsv}"; RUNS="${5:?runs}"
RESULTS="${6:-bench-results.jsonl}"
ENV_FILE="${MACARON_ENV_FILE:-$HOME/.config/macaron/dev.env}"
ADMIN="http://127.0.0.1:18080"
MODEL="${BENCH_MODEL:-claude-haiku-4-5}"
BUDGET="${BENCH_BUDGET_USD:-5}"
RPM="${BENCH_RPM:-60}"
DB=(podman exec -i macaron-bifrost-dev-postgres psql -tA -U bifrost -d bifrost)

password="$(grep -E '^BIFROST_ADMIN_PASSWORD=' "$ENV_FILE" | tail -n 1 | cut -d= -f2-)"
[[ -n "$password" ]] || { echo "BIFROST_ADMIN_PASSWORD is not set in $ENV_FILE" >&2; exit 1; }
admin() { # method path [json body]: the password goes to curl on stdin, not on its command line
  printf 'user = "macaron:%s"\n' "$password" | curl -sS -K - -X "$1" "$ADMIN$2" -H 'content-type: application/json' ${3:+-d "$3"}
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# The cases come in on fd 3: the review reads stdin.
while IFS=$'\t' read -r -u 3 name base head project repo; do
  [[ -z "$name" || "$name" == \#* ]] && continue
  tree="$work/tree-$name"
  git -C "$CHECKOUT" worktree add --quiet --detach "$tree" "$head"
  for run in $(seq 1 "$RUNS"); do
    key_name="bench-$LABEL-$name-$run-$(date +%s)"
    expires="$(date -u -d '+3 hours' +%Y-%m-%dT%H:%M:%SZ)"
    created="$(admin POST /api/governance/virtual-keys "$(jq -nc --arg name "$key_name" --arg model "$MODEL" --argjson budget "$BUDGET" --argjson rpm "$RPM" --arg expires "$expires" \
      '{name: $name, provider_configs: [{provider: "anthropic", allowed_models: [$model], key_ids: ["*"]}], budgets: [{max_limit: $budget, reset_duration: "1Y"}], rate_limit: {request_max_limit: $rpm, request_reset_duration: "1m"}, expires_at: $expires}')")"
    key_id="$(jq -r .virtual_key.id <<<"$created")"
    key="$(jq -r .virtual_key.value <<<"$created")"
    config_dir="$work/claude-$name-$run"; mkdir -p "$config_dir"
    started="$(date +%s)"
    set +e
    # As the runner's claudeEnvironment: every model class maps to the review model, capped output.
    env CLAUDE_CONFIG_DIR="$config_dir" ANTHROPIC_BASE_URL="$ADMIN/anthropic" ANTHROPIC_AUTH_TOKEN="$key" ANTHROPIC_API_KEY="" \
      ANTHROPIC_DEFAULT_OPUS_MODEL="$MODEL" ANTHROPIC_DEFAULT_SONNET_MODEL="$MODEL" ANTHROPIC_DEFAULT_HAIKU_MODEL="$MODEL" \
      CLAUDE_CODE_SUBAGENT_MODEL="$MODEL" CLAUDE_CODE_MAX_OUTPUT_TOKENS=16000 DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
      node "$ENGINE" review --project "$project" --repo "$repo" --base "$base" --committed --agent --model "$MODEL" --dir "$tree" \
      </dev/null >"$work/events-$name-$run.jsonl" 2>"$work/stderr-$name-$run.log"
    exit_code=$?
    set -e
    seconds=$(( $(date +%s) - started ))
    sleep 12 # Bifrost writes spend and logs a few seconds late
    usage="$("${DB[@]}" -F $'\t' -c "SELECT count(*) FILTER (WHERE status='success'), count(*) FILTER (WHERE error_details LIKE '%\"status_code\":429%'), count(*) FILTER (WHERE error_details LIKE '%\"status_code\":402%'), coalesce(round(sum(coalesce(cost,0))::numeric,4),0), coalesce(sum(CASE WHEN token_usage ~ '^\\{' THEN (token_usage::jsonb->>'prompt_tokens')::bigint END),0) FROM logs WHERE virtual_key_name='$key_name'")"
    IFS=$'\t' read -r ok limited budget_refused cost prompt_tokens <<<"$usage"
    admin DELETE "/api/governance/virtual-keys/$key_id" >/dev/null
    line="$(jq -sc --arg label "$LABEL" --arg case "$name" --argjson run "$run" --argjson exit "$exit_code" --argjson seconds "$seconds" \
      --argjson ok "$ok" --argjson limited "$limited" --argjson refused "$budget_refused" --argjson cost "$cost" --argjson prompt "$prompt_tokens" \
      --arg stderr "$(tail -c 400 "$work/stderr-$name-$run.log")" '
      (map(select(.type == "rule" and has("result")))) as $rules
      | (map(select(.type == "context"))[0] // {}) as $context
      | (map(select(.type == "complete"))[0] // {}) as $complete
      | { label: $label, case: $case, run: $run, exit: $exit, seconds: $seconds,
          requests: $ok, rateLimited: $limited, budgetRefused: $refused, costUsd: $cost, promptTokens: $prompt,
          rules: ($context.rules // null), skipped: ($context.skipped // null),
          violation: ($rules | map(select(.result == "violation")) | length),
          warning: ($rules | map(select(.result == "warning")) | length),
          valid: ($rules | map(select(.result == "valid")) | length),
          ignored: ($rules | map(select(.result == "ignored")) | length),
          notChecked: ($rules | map(select(.result == "ignored" and .explanation == "not checked")) | length),
          problems: ($complete.problems // null),
          completed: ($complete.status == "done"),
          error: (if $complete.status == "done" then null else $stderr end) }' "$work/events-$name-$run.jsonl")"
    echo "$line" | tee -a "$RESULTS"
    if [[ -n "${BENCH_LOGS:-}" ]]; then
      mkdir -p "$BENCH_LOGS"
      cp "$work/events-$name-$run.jsonl" "$BENCH_LOGS/$LABEL-$name-$run.events.jsonl"
      cp "$work/stderr-$name-$run.log" "$BENCH_LOGS/$LABEL-$name-$run.stderr.log"
    fi
  done
  git -C "$CHECKOUT" worktree remove --force "$tree"
done 3<"$CASES"
