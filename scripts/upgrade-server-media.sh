#!/usr/bin/env bash
# Target: the existing AlmaLinux Zhiye deployment described in docs/upgrade-media.md.
set -Eeuo pipefail
umask 077
archive="${1:-/root/zhiye-source-20261010.tar.gz}"
[[ "$EUID" -eq 0 ]] || { echo "Please run this script as root."; exit 1; }
[[ -f /opt/zhiye/.env && -f "$archive" && -f "$archive.sha256" ]] || { echo "Missing existing .env, release archive, or checksum."; exit 1; }
archive="$(realpath "$archive")"
(cd "$(dirname "$archive")" && sha256sum -c "$(basename "$archive").sha256")
getent passwd zhiye >/dev/null
systemctl cat zhiye >/dev/null
[[ "$(df -Pk /opt | awk 'NR==2 {print $4}')" -ge 2097152 ]] || { echo "At least 2GB free disk space is required."; exit 1; }
release_id="media-$(date -u +%Y%m%dT%H%M%SZ)-$$"
stage="/opt/zhiye-releases/$release_id"
previous="/opt/zhiye-releases/previous-$release_id"
install -d -m 755 /opt/zhiye-releases
install -d -m 755 -o zhiye -g zhiye "$stage"
tar -xzf "$archive" -C "$stage"
cp -a /opt/zhiye/.env "$stage/.env"
chown -R zhiye:zhiye "$stage"
chmod 600 "$stage/.env"
stopped=0
switched=0
rollback() {
  result=$?
  trap - EXIT
  if [[ "$result" -ne 0 ]]; then
    if [[ "$switched" -eq 1 ]]; then
      systemctl stop zhiye || true
      if [[ -L /opt/zhiye && "$(readlink /opt/zhiye)" == "$stage" ]]; then unlink /opt/zhiye; fi
      if [[ ! -e /opt/zhiye ]]; then mv "$previous" /opt/zhiye; fi
    fi
    if [[ "$stopped" -eq 1 ]]; then systemctl start zhiye || true; fi
    echo "Upgrade failed. Existing code was kept at $previous or /opt/zhiye. The new migration only adds a table; existing data was not removed."
  fi
  exit "$result"
}
trap rollback EXIT
echo "Preparing dependencies and building the new release while the current website stays available."
runuser -u zhiye -- sh -c 'cd "$1" && npm ci --no-audit --no-fund' sh "$stage"
npm_help="$(npm help 2>/dev/null || true)"
if [[ "$npm_help" == *install-scripts* ]]; then
  runuser -u zhiye -- sh -c 'cd "$1" && npm install-scripts approve @prisma/engines better-sqlite3 esbuild prisma && npm rebuild @prisma/engines better-sqlite3 esbuild prisma --foreground-scripts' sh "$stage"
fi
runuser -u zhiye -- sh -c 'cd "$1" && npm run db:generate && NODE_OPTIONS=--max-old-space-size=768 nice -n 10 npm run build' sh "$stage"
echo "Stopping the website briefly to back up data and apply the additive migration."
systemctl stop zhiye
stopped=1
# Also works with the old backup script, which checks BETTER_AUTH_URL's public port.
runuser -u zhiye -- sh -c 'umask 077; cd /opt/zhiye && BETTER_AUTH_URL=http://127.0.0.1:3000 BACKUP_APP_URL=http://127.0.0.1:3000 npm run backup'
runuser -u zhiye -- sh -c 'cd "$1" && npm run db:migrate' sh "$stage"
mv /opt/zhiye "$previous"
switched=1
ln -s "$stage" /opt/zhiye
systemctl start zhiye
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 2 --max-time 15 --output /dev/null http://127.0.0.1:3000/
systemctl is-active zhiye
trap - EXIT
echo "Upgrade complete"
echo "Previous code and its backups: $previous"
echo "Current release: $stage"
