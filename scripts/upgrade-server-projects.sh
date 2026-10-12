#!/usr/bin/env bash
# Existing AlmaLinux single-instance deployment; see docs/upgrade-projects.md.
set -Eeuo pipefail
umask 077
archive="${1:-/root/zhiye-source-20261011-projects.tar.gz}"
[[ "$EUID" -eq 0 ]] || { echo "Run this upgrade as root."; exit 1; }
for executable in awk basename cat cp chmod chown curl date df dirname du flock getent install ln mv nice node npm readlink realpath rm runuser seq sha256sum sleep systemctl tar unlink; do
  command -v "$executable" >/dev/null || { echo "Missing required program: $executable"; exit 1; }
done
exec 9>/run/lock/zhiye-upgrade.lock
flock -n 9 || { echo "Another Zhiye upgrade is running."; exit 1; }
[[ -d /opt/zhiye && -f /opt/zhiye/.env && -f "$archive" && -f "$archive.sha256" ]] || {
  echo "Missing existing application/configuration, archive, or checksum."; exit 1;
}
getent passwd zhiye >/dev/null
systemctl cat zhiye >/dev/null
[[ "$(df -Pk /opt | awk 'NR==2 {print $4}')" -ge 2097152 ]] || {
  echo "At least 2GB free space is required before dependency preparation."; exit 1;
}
archive="$(realpath "$archive")"
(cd "$(dirname "$archive")" && sha256sum -c "$(basename "$archive").sha256")
# The release contains source only; refuse absolute paths, traversal and archive links.
while IFS= read -r member; do
  [[ "$member" != /* && "$member" != ../* && "$member" != *'/../'* && "$member" != */.. ]] || {
    echo "Unsafe release archive path."; exit 1;
  }
done < <(tar -tzf "$archive")
tar -tvzf "$archive" | awk 'substr($0,1,1)=="l" || substr($0,1,1)=="h" {bad=1} END {exit bad}' || {
  echo "Release archive must not contain links."; exit 1;
}
release_id="projects-$(date -u +%Y%m%dT%H%M%SZ)-$$"
stage="/opt/zhiye-releases/$release_id"
previous="/opt/zhiye-releases/previous-$release_id"
worker_unit=/etc/systemd/system/zhiye-project-worker.service
had_worker=0
worker_was_active=0
worker_was_enabled=0
if systemctl cat zhiye-project-worker >/dev/null 2>&1; then had_worker=1; fi
if systemctl is-active --quiet zhiye-project-worker; then worker_was_active=1; fi
if systemctl is-enabled --quiet zhiye-project-worker 2>/dev/null; then worker_was_enabled=1; fi
website_was_active=0
if systemctl is-active --quiet zhiye; then website_was_active=1; fi
install -d -m 755 /opt/zhiye-releases
install -d -m 755 -o zhiye -g zhiye "$stage"
tar -xzf "$archive" --no-same-owner --no-same-permissions -C "$stage"
[[ -f "$stage/package-lock.json" && -f "$stage/scripts/project-worker.ts" && -f "$stage/scripts/backup.ts" ]] || {
  echo "Incomplete release archive."; exit 1;
}
cp -a /opt/zhiye/.env "$stage/.env"
chown -R zhiye:zhiye "$stage"
chmod 600 "$stage/.env"
if [[ -f "$worker_unit" ]]; then cp -a "$worker_unit" "$stage/previous-worker.service"; fi
stopped=0
switched=0
unit_installed=0
rollback() {
  result=$?
  trap - EXIT
  if [[ "$result" -ne 0 ]]; then
    if [[ "$unit_installed" -eq 1 ]]; then
      systemctl stop zhiye-project-worker || true
      systemctl disable zhiye-project-worker >/dev/null 2>&1 || true
      if [[ -f "$stage/previous-worker.service" ]]; then cp -a "$stage/previous-worker.service" "$worker_unit";
      else rm -f "$worker_unit"; fi
      systemctl daemon-reload || true
      if [[ "$worker_was_enabled" -eq 1 ]]; then systemctl enable zhiye-project-worker >/dev/null 2>&1 || true; fi
    fi
    if [[ "$switched" -eq 1 ]]; then
      systemctl stop zhiye || true
      if [[ -L /opt/zhiye && "$(readlink /opt/zhiye)" == "$stage" ]]; then unlink /opt/zhiye; fi
      if [[ ! -e /opt/zhiye && ! -L /opt/zhiye ]]; then mv "$previous" /opt/zhiye; fi
    fi
    if [[ "$stopped" -eq 1 && "$website_was_active" -eq 1 ]]; then systemctl start zhiye || true; fi
    if [[ "$stopped" -eq 1 && "$worker_was_active" -eq 1 ]]; then systemctl start zhiye-project-worker || true; fi
    echo "Upgrade failed. Original code is at /opt/zhiye or $previous."
    echo "Any completed local backup is in $stage/backups. No database restore was performed."
  fi
  exit "$result"
}
trap rollback EXIT
echo "Preparing dependencies and build while the current website remains available."
runuser -u zhiye -- sh -c 'cd "$1" && npm ci --no-audit --no-fund' sh "$stage"
npm_help="$(npm help 2>/dev/null || true)"
if [[ "$npm_help" == *install-scripts* ]]; then
  runuser -u zhiye -- sh -c 'cd "$1" && npm install-scripts approve @prisma/engines better-sqlite3 esbuild prisma && npm rebuild @prisma/engines better-sqlite3 esbuild prisma --foreground-scripts' sh "$stage"
fi
# Read only deployment paths, never print configuration secrets or execute .env as shell code.
project_temp="$(node --input-type=module - "$stage" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
const stage = process.argv[2];
const { parse } = await import(path.join(stage, 'node_modules/dotenv/lib/main.js'));
const envPath = path.join(stage, '.env');
const original = fs.readFileSync(envPath, 'utf8');
const env = parse(original);
if (!env.DATABASE_URL?.startsWith('file:') || !path.isAbsolute(env.DATABASE_URL.slice(5)) || !env.STORAGE_DIR || !path.isAbsolute(env.STORAGE_DIR)) {
  console.error('DATABASE_URL and STORAGE_DIR must use absolute persistent paths before upgrading.'); process.exit(1);
}
const old = fs.realpathSync('/opt/zhiye');
for (const value of [env.DATABASE_URL.slice(5), env.STORAGE_DIR]) {
  const normalized = path.resolve(value);
  if (normalized === old || normalized.startsWith(old + path.sep) || normalized === '/opt/zhiye' || normalized.startsWith('/opt/zhiye/')) {
    console.error('Database and files must be outside the application release.'); process.exit(1);
  }
}
const temporary = env.PROJECT_TEMP_DIR || '/var/lib/zhiye/project-tasks';
const files = path.resolve(env.STORAGE_DIR);
const normalizedTemporary = path.resolve(temporary);
if (!path.isAbsolute(temporary) || !normalizedTemporary.startsWith('/var/lib/zhiye/') || normalizedTemporary === files || normalizedTemporary.startsWith(files + path.sep) || files.startsWith(normalizedTemporary + path.sep)) {
  console.error('PROJECT_TEMP_DIR must use its own directory below /var/lib/zhiye/.'); process.exit(1);
}
const persistentRoot = fs.realpathSync('/var/lib/zhiye');
let ancestor = normalizedTemporary;
while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
const resolvedAncestor = fs.realpathSync(ancestor);
if ((resolvedAncestor !== persistentRoot && !resolvedAncestor.startsWith(persistentRoot + path.sep)) || (fs.existsSync(normalizedTemporary) && fs.lstatSync(normalizedTemporary).isSymbolicLink())) {
  console.error('PROJECT_TEMP_DIR must not escape persistent storage through a symlink.'); process.exit(1);
}
if (!env.PROJECT_TEMP_DIR) fs.appendFileSync(envPath, '\nPROJECT_TEMP_DIR="' + temporary + '"\n', { mode: 0o600 });
console.log(temporary);
NODE
)"
install -d -m 700 -o zhiye -g zhiye "$project_temp"
persistent_files="$(node --input-type=module - "$stage" <<'NODE'
import fs from 'node:fs'; import path from 'node:path';
const stage = process.argv[2]; const { parse } = await import(path.join(stage, 'node_modules/dotenv/lib/main.js'));
console.log(parse(fs.readFileSync(path.join(stage, '.env'), 'utf8')).STORAGE_DIR);
NODE
)"
persistent_database="$(node --input-type=module - "$stage" <<'NODE'
import fs from 'node:fs'; import path from 'node:path';
const stage = process.argv[2]; const { parse } = await import(path.join(stage, 'node_modules/dotenv/lib/main.js'));
console.log(parse(fs.readFileSync(path.join(stage, '.env'), 'utf8')).DATABASE_URL.slice(5));
NODE
)"
backup_kib="$(du -sk "$persistent_files" "$project_temp" "$persistent_database" | awk '{total += $1} END {print total}')"
if [[ -f "$persistent_database-wal" ]]; then
  wal_kib="$(du -sk "$persistent_database-wal" | awk '{print $1}')"
  backup_kib=$((backup_kib + wal_kib))
fi
free_kib="$(df -Pk "$stage" | awk 'NR==2 {print $4}')"
[[ "$free_kib" -ge $((backup_kib + 3145728)) ]] || {
  echo "Insufficient disk space: leave room for a full file backup plus 3GB build/temporary reserve."; exit 1;
}
runuser -u zhiye -- sh -c 'cd "$1" && npm run db:generate && NODE_OPTIONS=--max-old-space-size=768 nice -n 10 npm run build' sh "$stage"
echo "Stopping website and project worker for a consistent backup and additive migration."
stopped=1
systemctl stop zhiye
if [[ "$had_worker" -eq 1 ]]; then systemctl stop zhiye-project-worker; fi
# A forcibly stopped worker may keep its last lease for at most two minutes. Do not delete its lease.
backed_up=0
for attempt in $(seq 1 30); do
  if backup_output="$(runuser -u zhiye -- sh -c 'umask 077; cd "$1" && BACKUP_APP_URL=http://127.0.0.1:3000 npm run backup' sh "$stage" 2>&1)"; then
    printf '%s\n' "$backup_output"
    backed_up=1
    break
  else
    backup_status=$?
  fi
  printf '%s\n' "$backup_output"
  [[ "$backup_status" -eq 75 ]] || break
  if [[ "$attempt" -lt 30 ]]; then sleep 5; fi
done
[[ "$backed_up" -eq 1 ]] || { echo "Backup did not complete; migration canceled."; exit 1; }
runuser -u zhiye -- sh -c 'cd "$1" && npm run db:migrate' sh "$stage"
mv /opt/zhiye "$previous"
switched=1
ln -s "$stage" /opt/zhiye
unit_installed=1
cat > "$worker_unit" <<'UNIT'
# Managed by Zhiye project deployment.
[Unit]
Description=Zhiye private project synchronization worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=zhiye
Group=zhiye
WorkingDirectory=/opt/zhiye
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--max-old-space-size=256
ExecStart=/usr/bin/node /opt/zhiye/node_modules/tsx/dist/cli.mjs /opt/zhiye/scripts/project-worker.ts
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillMode=control-group
MemoryMax=384M
CPUWeight=25
Nice=10
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl start zhiye
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 2 --max-time 15 --output /dev/null http://127.0.0.1:3000/
curl --fail --silent --show-error --max-time 20 --output /dev/null http://127.0.0.1:3000/projects
systemctl enable --now zhiye-project-worker
systemctl is-active zhiye zhiye-project-worker
trap - EXIT
echo "Code upgrade complete"
echo "Previous code/link: $previous"
echo "New release and local backups: $stage"
echo "Nginx, certificates, firewall and VPN configuration were preserved."
echo "Next: docs/upgrade-projects.md explains the dedicated 210m Nginx project upload location."
echo "Next: docs/github-setup.md explains the GitHub organization/app configuration."
