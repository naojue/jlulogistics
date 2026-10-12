#!/usr/bin/env bash
# Exercise deployment and rollback against disposable files and mocked services.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_ROOT="$(mktemp -d "$ROOT/releases/.deploy-test.XXXXXX")"
trap 'rm -rf -- "$TEST_ROOT"' EXIT
mkdir "$TEST_ROOT/bin"
cat > "$TEST_ROOT/bin/id" <<'EOF'
#!/usr/bin/env bash
printf '0\n'
EOF
cat > "$TEST_ROOT/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  show)
    if [[ "$*" == *WorkingDirectory* ]]; then printf '%s\n' "$UI_DEPLOY_APP_ROOT"; else printf 'fixture-user\n'; fi
    ;;
  is-active) [[ "$(cat "$TEST_CASE/service-state")" == active ]] ;;
  stop) printf 'inactive' > "$TEST_CASE/service-state" ;;
  start) printf 'active' > "$TEST_CASE/service-state" ;;
esac
EOF
cat > "$TEST_ROOT/bin/runuser" <<'EOF'
#!/usr/bin/env bash
[[ "${FAIL_BUILD:-false}" != true ]] || exit 19
mkdir -p "$UI_DEPLOY_APP_ROOT/.next"
printf 'new-build' > "$UI_DEPLOY_APP_ROOT/.next/BUILD_ID"
EOF
cat > "$TEST_ROOT/bin/curl" <<'EOF'
#!/usr/bin/env bash
output="${@: -1}"
url="${@: -3:1}"
[[ "${FAIL_HEALTH:-false}" != true ]] || exit 22
case "$url" in
  */brand/jida-logistics-v1.png) cp "$UI_DEPLOY_APP_ROOT/public/brand/jida-logistics-v1.png" "$output" ;;
  */theme-init.js)
    if [[ "${MISMATCH_ASSET:-false}" == true ]]; then
      printf 'wrong-theme-script' > "$output"
    else
      cp "$UI_DEPLOY_APP_ROOT/public/theme-init.js" "$output"
    fi
    ;;
  *) printf '吉大物流 theme-init.js' > "$output" ;;
esac
EOF
cat > "$TEST_ROOT/bin/flock" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat > "$TEST_ROOT/bin/chown" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat > "$TEST_ROOT/bin/sleep" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat > "$TEST_ROOT/bin/node" <<'EOF'
#!/usr/bin/env bash
printf '24\n'
EOF
cat > "$TEST_ROOT/bin/npm" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat > "$TEST_ROOT/bin/cmp" <<'EOF'
#!/usr/bin/env bash
printf 'cmp: command not found\n' >&2
exit 127
EOF
chmod +x "$TEST_ROOT/bin/"*
export PATH="$TEST_ROOT/bin:$PATH"

for scenario in check success build-failure health-failure asset-mismatch; do
  export TEST_CASE="$TEST_ROOT/$scenario"
  export UI_DEPLOY_APP_ROOT="$TEST_CASE/app"
  export UI_DEPLOY_BACKUP_ROOT="$TEST_CASE/backups"
  export FAIL_BUILD=false FAIL_HEALTH=false MISMATCH_ASSET=false
  mkdir -p "$UI_DEPLOY_APP_ROOT/"{src/app,src/components,node_modules,.next,data/files}
  printf 'old-layout' > "$UI_DEPLOY_APP_ROOT/src/app/layout.tsx"
  printf '{}' > "$UI_DEPLOY_APP_ROOT/package.json"
  printf 'old-build' > "$UI_DEPLOY_APP_ROOT/.next/BUILD_ID"
  printf 'database-sentinel' > "$UI_DEPLOY_APP_ROOT/data/community.db"
  printf 'private-file-sentinel' > "$UI_DEPLOY_APP_ROOT/data/files/keep"
  printf 'configuration-sentinel' > "$UI_DEPLOY_APP_ROOT/.env"
  printf 'active' > "$TEST_CASE/service-state"
  args=()
  [[ "$scenario" != check ]] || args=(--check)
  [[ "$scenario" != build-failure ]] || export FAIL_BUILD=true
  [[ "$scenario" != health-failure ]] || export FAIL_HEALTH=true
  [[ "$scenario" != asset-mismatch ]] || export MISMATCH_ASSET=true
  result=0
  bash "$ROOT/releases/jida-ui-20261010.sh" "${args[@]}" > "$TEST_CASE/output.log" 2>&1 || result=$?
  if [[ "$scenario" == success ]]; then
    [[ "$result" == 0 && "$(cat "$UI_DEPLOY_APP_ROOT/.next/BUILD_ID")" == new-build ]]
    grep -q UI_UPDATE_OK "$TEST_CASE/output.log"
    source_hash="$(sha256sum "$ROOT/src/app/layout.tsx")"
    deployed_hash="$(sha256sum "$UI_DEPLOY_APP_ROOT/src/app/layout.tsx")"
    [[ "${source_hash%% *}" == "${deployed_hash%% *}" ]]
  else
    if [[ "$scenario" == check ]]; then [[ "$result" == 0 ]]; else [[ "$result" != 0 ]]; fi
    [[ "$(cat "$UI_DEPLOY_APP_ROOT/src/app/layout.tsx")" == old-layout ]]
    [[ "$(cat "$UI_DEPLOY_APP_ROOT/.next/BUILD_ID")" == old-build ]]
    [[ ! -e "$UI_DEPLOY_APP_ROOT/src/components/brand.tsx" ]]
  fi
  if grep -q 'cmp: command not found' "$TEST_CASE/output.log"; then
    printf 'Unexpected dependency on cmp in scenario: %s\n' "$scenario" >&2
    exit 1
  fi
  [[ "$(cat "$TEST_CASE/service-state")" == active ]]
  [[ "$(cat "$UI_DEPLOY_APP_ROOT/data/community.db")" == database-sentinel ]]
  [[ "$(cat "$UI_DEPLOY_APP_ROOT/data/files/keep")" == private-file-sentinel ]]
  [[ "$(cat "$UI_DEPLOY_APP_ROOT/.env")" == configuration-sentinel ]]
  printf 'PASS: %s (accounts, private files and configuration preserved)\n' "$scenario"
done
