#!/usr/bin/env bash
# Offline recovery for the existing single-instance AlmaLinux deployment.
set -Eeuo pipefail
umask 077
[[ "$EUID" -eq 0 ]] || { echo "请在服务器 root 终端运行。"; exit 1; }
[[ -t 0 && -t 1 ]] || { echo "请在交互终端运行。"; exit 1; }
[[ -f /opt/zhiye/scripts/reset-super-admin.mjs && -f /var/lib/zhiye/community.db ]] || {
  echo "缺少恢复工具或现有数据库。"; exit 1;
}
for executable in flock runuser systemctl node; do
  command -v "$executable" >/dev/null || { echo "缺少程序：$executable"; exit 1; }
done
cd /opt/zhiye
exec 9>/run/lock/zhiye-upgrade.lock
flock -n 9 || { echo "已有升级或维护任务正在运行。"; exit 1; }
website_was_active=0
worker_was_active=0
if systemctl is-active --quiet zhiye; then website_was_active=1; fi
if systemctl is-active --quiet zhiye-project-worker; then worker_was_active=1; fi
restore_services() {
  result=$?
  trap - EXIT
  if [[ "$website_was_active" -eq 1 ]]; then
    if ! systemctl start zhiye; then echo "网站启动失败，请检查服务状态。"; result=1; fi
  fi
  if [[ "$worker_was_active" -eq 1 ]]; then
    if ! systemctl start zhiye-project-worker; then echo "项目进程启动失败，请检查服务状态。"; result=1; fi
  fi
  exit "$result"
}
trap restore_services EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
echo "临时停止网站及项目同步进程，密码不会显示或写入命令历史。"
if systemctl cat zhiye-project-worker >/dev/null 2>&1; then systemctl stop zhiye-project-worker; fi
systemctl stop zhiye
runuser -u zhiye -- env ZHIYE_RECOVERY_OFFLINE=1 node scripts/reset-super-admin.mjs \
  --database /var/lib/zhiye/community.db --backup-dir /var/lib/zhiye/account-recovery
echo "密码恢复完成，正在恢复原先运行的服务。"
