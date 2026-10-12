#!/usr/bin/env bash
# Packaged by scripts/package-ui-release.mjs with an embedded UI-only archive.
set -Eeuo pipefail
umask 027

APP_ROOT="${UI_DEPLOY_APP_ROOT:-/opt/zhiye}"
BACKUP_ROOT="${UI_DEPLOY_BACKUP_ROOT:-/opt/zhiye-ui-backups}"
SERVICE="${UI_DEPLOY_SERVICE:-zhiye}"
LOCAL_URL="${UI_DEPLOY_LOCAL_URL:-http://127.0.0.1:3000}"
CHECK_ONLY=false
if [[ "${1:-}" == "--check" ]]; then
  CHECK_ONLY=true
elif [[ $# -gt 0 ]]; then
  printf 'Usage: bash %s [--check]\n' "$0" >&2
  exit 2
fi

FILES=(
  src/app/globals.css
  src/app/layout.tsx
  src/app/page.tsx
  src/components/auth-page.tsx
  src/components/navigation.tsx
  src/components/brand.tsx
  src/components/theme-switcher.tsx
  src/components/supply-chain-art.tsx
  public/theme-init.js
  public/brand/jida-logistics-v1.png
)

[[ "$(id -u)" == 0 ]] || { printf 'Please run this installer as root.\n' >&2; exit 1; }
for command in id awk base64 tar sha256sum systemctl runuser curl flock node npm readlink mkdir chmod mktemp tail sort find dirname cp chown mv grep sleep rm date; do
  command -v "$command" >/dev/null || { printf 'Missing command: %s\n' "$command" >&2; exit 1; }
done

same_file() {
  local left right
  left="$(sha256sum -- "$1")" || return 1
  right="$(sha256sum -- "$2")" || return 1
  [[ "${left%% *}" == "${right%% *}" ]]
}

APP_ROOT="$(readlink -f "$APP_ROOT")"
[[ -d "$APP_ROOT/src" && -f "$APP_ROOT/package.json" && -d "$APP_ROOT/node_modules" ]]
[[ -f "$APP_ROOT/.next/BUILD_ID" ]] || { printf 'Existing production build is missing.\n' >&2; exit 1; }
WORKING_DIR="$(systemctl show "$SERVICE" --property=WorkingDirectory --value)"
[[ "$(readlink -f "$WORKING_DIR")" == "$APP_ROOT" ]] || { printf 'Service working directory does not match the application.\n' >&2; exit 1; }
APP_USER="$(systemctl show "$SERVICE" --property=User --value)"
[[ -n "$APP_USER" && "$APP_USER" != root ]] || { printf 'Expected a dedicated website service account.\n' >&2; exit 1; }
systemctl is-active --quiet "$SERVICE"
[[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 24 ]] || { printf 'Node.js 24 or later is required.\n' >&2; exit 1; }

mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"
exec 9>"$BACKUP_ROOT/.deploy.lock"
flock -n 9 || { printf 'Another UI deployment is running.\n' >&2; exit 1; }
WORK_DIR="$(mktemp -d "$BACKUP_ROOT/.payload.XXXXXX")"
BACKUP=""
STOPPED=false
PATCHED=false
OLD_BUILD_MOVED=false
SUCCESS=false

finish() {
  local result=$?
  trap - EXIT INT TERM
  set +e
  if [[ "$SUCCESS" != true && "$STOPPED" == true ]]; then
    printf '\nUpdate failed. Restoring the previous UI...\n' >&2
    systemctl stop "$SERVICE"
    local restored=true
    if [[ "$PATCHED" == true ]]; then
      while IFS= read -r file; do
        cp -a "$BACKUP/files/$file" "$APP_ROOT/$file" || restored=false
      done < "$BACKUP/existing-files.txt"
      while IFS= read -r file; do
        rm -f -- "$APP_ROOT/$file" || restored=false
      done < "$BACKUP/new-files.txt"
    fi
    if [[ "$OLD_BUILD_MOVED" == true ]]; then
      if [[ -e "$APP_ROOT/.next" ]]; then
        mv "$APP_ROOT/.next" "$BACKUP/failed-next" || restored=false
      fi
      mv "$BACKUP/next" "$APP_ROOT/.next" || restored=false
    fi
    if [[ "$restored" == true ]] && systemctl start "$SERVICE" && systemctl is-active --quiet "$SERVICE"; then
      printf 'Previous website restored. Backup: %s\n' "$BACKUP" >&2
    else
      printf 'Automatic restart failed. Run: systemctl start %s\nBackup: %s\n' "$SERVICE" "$BACKUP" >&2
    fi
  fi
  if [[ -n "${WORK_DIR:-}" && "$WORK_DIR" == "$BACKUP_ROOT"/.payload.* ]]; then
    rm -rf -- "$WORK_DIR"
  fi
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

ARCHIVE_LINE="$(awk '/^__UI_ARCHIVE_BELOW__$/ { print NR + 1; exit }' "$0")"
[[ -n "$ARCHIVE_LINE" ]] || { printf 'Embedded UI archive is missing.\n' >&2; exit 1; }
tail -n +"$ARCHIVE_LINE" "$0" | base64 --decode > "$WORK_DIR/ui.tar.gz"
printf '%s\n' "${FILES[@]}" SHA256SUMS | sort > "$WORK_DIR/expected-files.txt"
tar -tzf "$WORK_DIR/ui.tar.gz" | sort > "$WORK_DIR/archive-files.txt"
same_file "$WORK_DIR/expected-files.txt" "$WORK_DIR/archive-files.txt" || { printf 'Unexpected archive file list.\n' >&2; exit 1; }
mkdir "$WORK_DIR/payload"
tar -xzf "$WORK_DIR/ui.tar.gz" -C "$WORK_DIR/payload"
[[ -z "$(find "$WORK_DIR/payload" -type l -print -quit)" ]]
(cd "$WORK_DIR/payload" && sha256sum --check SHA256SUMS)
for file in "${FILES[@]}"; do
  parent="$(readlink -m "$APP_ROOT/$(dirname "$file")")"
  [[ "$parent" == "$APP_ROOT"/* && ! -L "$APP_ROOT/$file" ]] || { printf 'Unexpected target path: %s\n' "$file" >&2; exit 1; }
done

if [[ "$CHECK_ONLY" == true ]]; then
  SUCCESS=true
  printf '\nChecks passed. No website files were changed.\n'
  exit 0
fi

BACKUP="$BACKUP_ROOT/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$BACKUP/files"
chmod 700 "$BACKUP"
: > "$BACKUP/existing-files.txt"
: > "$BACKUP/new-files.txt"
for file in "${FILES[@]}"; do
  if [[ -f "$APP_ROOT/$file" ]]; then
    mkdir -p "$BACKUP/files/$(dirname "$file")"
    cp -a "$APP_ROOT/$file" "$BACKUP/files/$file"
    printf '%s\n' "$file" >> "$BACKUP/existing-files.txt"
  else
    printf '%s\n' "$file" >> "$BACKUP/new-files.txt"
  fi
done
cp "$WORK_DIR/payload/SHA256SUMS" "$BACKUP/deployed-checksums.txt"
printf 'Backup: %s\nBuilding the new UI; the website will be briefly unavailable.\n' "$BACKUP"
STOPPED=true
systemctl stop "$SERVICE"
mv "$APP_ROOT/.next" "$BACKUP/next"
OLD_BUILD_MOVED=true
PATCHED=true
for file in "${FILES[@]}"; do
  mkdir -p "$APP_ROOT/$(dirname "$file")"
  cp "$WORK_DIR/payload/$file" "$APP_ROOT/$file"
  chown "$APP_USER:" "$APP_ROOT/$file"
  chmod 644 "$APP_ROOT/$file"
done
chown "$APP_USER:" "$APP_ROOT/public" "$APP_ROOT/public/brand"
runuser -u "$APP_USER" -- bash -c 'cd "$1" && NODE_ENV=production npm run build && npm run typecheck' bash "$APP_ROOT"
systemctl start "$SERVICE"

HEALTHY=false
for ((attempt = 1; attempt <= 30; attempt++)); do
  if systemctl is-active --quiet "$SERVICE" &&
    curl --fail --silent --show-error --max-time 10 "$LOCAL_URL/" -o "$WORK_DIR/home.html" &&
    grep -q 'theme-init.js' "$WORK_DIR/home.html" &&
    grep -q '吉大物流' "$WORK_DIR/home.html" &&
    curl --fail --silent --show-error --max-time 10 "$LOCAL_URL/theme-init.js" -o "$WORK_DIR/theme.js" &&
    curl --fail --silent --show-error --max-time 10 "$LOCAL_URL/brand/jida-logistics-v1.png" -o "$WORK_DIR/brand.png" &&
    same_file "$WORK_DIR/theme.js" "$WORK_DIR/payload/public/theme-init.js" &&
    same_file "$WORK_DIR/brand.png" "$WORK_DIR/payload/public/brand/jida-logistics-v1.png"; then
    HEALTHY=true
    break
  fi
  sleep 2
done
[[ "$HEALTHY" == true ]] || { printf 'Website health check failed.\n' >&2; exit 1; }
SUCCESS=true
printf '\nUI_UPDATE_OK\nBackup: %s\n' "$BACKUP"
exit 0
