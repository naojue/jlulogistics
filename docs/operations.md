# 配置、备份恢复与上线

## 配置

复制 `.env.example` 后运行 setup，或让 setup 自动创建本地 `.env`。DATABASE_URL 和 STORAGE_DIR 是持久化数据位置。BETTER_AUTH_URL 是网站真实地址，必须与浏览器地址一致（localhost 和 127.0.0.1 不混用）。BETTER_AUTH_SECRET 至少 32 字符。初始管理员邮箱密码只用于第一次创建账号。

SMTP_HOST / PORT / SECURE / USER / PASSWORD 与 MAIL_FROM 控制邮件。生产必须使用能实际投递邮件的 SMTP 服务，并验证发件域名配置。Mailpit 只用于开发，不向外网暴露它的收件箱。

PROJECT_TEMP_DIR 是持久化的私有项目任务目录；生产使用代码目录外的绝对路径，例如 `/var/lib/zhiye/project-tasks`。GITHUB_ORGANIZATION / APP_ID / INSTALLATION_ID / PRIVATE_KEY_PATH 控制组织应用接入，完整步骤见 [GitHub 配置](github-setup.md)。GitHub App 私钥放在私有位置，仅服务器服务用户可读，不进入源码包或公开目录。

## 备份

先停止网站和项目同步服务，保留邮件进程不影响数据备份，然后执行 `npm run backup`。脚本默认检查本地 127.0.0.1:3000，不用公网 HTTPS 判断停机状态；自定义端口时设置 BACKUP_APP_URL。

新版脚本排他创建临时目录中的 `.backup-lock`，并原子获取与 worker 相同的 SQLite 租约。worker 入场和获取租约后复查维护锁，避免备份时空闲 worker 再开始任务。存在有效 worker 租约时，备份退出码为 75；先停止 worker，强制结束后最多等约两分钟让租约过期，再重试。不通过强制删除有效租约绕过保护。

确认没有写入后，SQLite backup API 生成数据库副本，复制全部私有图片、资料文件及尚未同步的项目任务目录。数据库和文件在同一次停机窗口保存；不复制运行时维护锁，数据库副本也不继承备份自己的租约。

目前服务器可在 root 终端这样备份；这是两个本站服务已安装后的命令：

```bash
(
set -e
trap 'systemctl start zhiye zhiye-project-worker' EXIT
systemctl stop zhiye zhiye-project-worker
runuser -u zhiye -- sh -c 'umask 077; cd /opt/zhiye && BACKUP_APP_URL=http://127.0.0.1:3000 npm run backup'
)
```

如果提示有效租约，保持两个服务停止，等待约两分钟后再运行备份，再启动服务。使用上述带 trap 的命令时，错误退出也会恢复服务，需要重新停止并备份。只在输出“本地备份完成”且目录中有完整 manifest.json 后，才将该目录作为可恢复备份；失败留下的不完整目录不得用于恢复。

备份位于 `backups/<时间>`，包含 community.db、files、project-tasks、remote-projects.json 和 manifest.json。另行保存对应 `.env`、GitHub App 私钥及代码 / 锁文件。数据库含账号、内部讨论和项目版本，临时包也可能含私有源码，备份应保存到受控位置。定期复制到另一块磁盘或可靠备份服务；仅同盘副本不能应对磁盘故障。

**已发布的 GitHub 源码不在本地备份中。** remote-projects.json 只列组织、仓库和历史提交，数据库保存各版本的文件校验清单。需要另外为私有仓库建立带全部分支和提交的镜像备份；可在受控电脑使用已授权的 Git 凭据管理器执行 `git clone --mirror https://github.com/组织名/仓库名.git`，不要把 token 写入 URL、命令历史或聊天。GitHub 页面“下载 ZIP”适合导出一个版本，不能替代保留全部历史的仓库备份。

备份进程意外中断时，维护锁可能留存；不要自动或强行删除。停止两个服务、确认锁中记录的备份进程已结束且没有另一次备份之后，再由管理员检查并移走旧锁。检查失败前原资料与数据库不会被备份脚本删除。

## 恢复

1. 停止网站与项目 worker，确认备份完整、版本与代码匹配，先将当前数据库、文件和临时任务目录另存保留。
2. 按 DATABASE_URL 放回 community.db；按 STORAGE_DIR 放回完整 files；按 PROJECT_TEMP_DIR 放回 project-tasks。默认本地对应 data/community.db、data/files 与 data/project-tasks，服务器使用 `.env` 的绝对路径。恢复时保持文件归属 `zhiye`、目录私有权限；不要把它们放到 public。
3. 恢复原 `.env` 配置；不要使用旧数据库文件旁的 WAL/SHM 文件。SQLite backup 生成的是完整独立数据库。
4. 恢复 GitHub App 私钥和组织配置，按 remote-projects.json 核对所有历史仓库及固定提交 SHA 仍在远端；远端源文件丢失时，先用另外的仓库镜像恢复，不能通过创建同名空仓库补齐旧版本。
5. 执行 `npm ci`、`npm run db:generate` 和 `npm run db:migrate`，启动网站及 `zhiye-project-worker`。旧的未完成任务可恢复执行，24 小时过期的包需要重新上传；任务保留原请求标识，避免重复发布版本。
6. 验证账号登录、资料下载、项目代码 / 历史下载、PDF 问题、讨论和管理操作。通过后再处理另存的旧数据。

此版本删除内容采用软删除，备份会包含保留的原始文件。不要直接手工清理文件目录；后续清理工具需要核对数据库关联。

## 单台服务器上线

使用 Node.js 24 与持久化磁盘。新安装执行 npm ci、setup、build，使用进程管理器运行 npm start，并独立运行 `node node_modules/tsx/dist/cli.mjs scripts/project-worker.ts`。旧站升级使用 [项目与 PDF 升级脚本](upgrade-projects.md)，不重新 seed。应用默认绑定 127.0.0.1，前面配置反向代理和 HTTPS。数据库、文件和项目任务目录使用持久位置，更新代码不得覆盖它们。

设置真实 BETTER_AUTH_URL、随机密钥、SMTP 与发件人。普通资料代理上限维持原 60m，项目上传精确位置 `/api/projects` 单独使用 210m、合适超时并关闭请求缓冲，配置样例见升级文档；应用仍分别执行资料 50MiB、项目 200MiB。仅反向代理暴露服务，不映射 data，不公开 Mailpit、SQLite 或 GitHub 私钥。至少每日备份并定期验证恢复；同时安排远端仓库导出。

本版本不支持无持久化磁盘的 Serverless 部署或多实例。改用这些环境前需要迁移 PostgreSQL 与私有对象存储、重做签名下载和迁移测试；不能只更换 DATABASE_URL。

## 预览与图片升级

2026-10-10 版本的升级步骤见 [预览与图片分享升级](upgrade-media.md)。新增迁移保留原有账号和主文件，新图片仍存入同一私有目录；数据库与全部图片必须一起备份。新备份脚本默认检查本地应用端口 127.0.0.1:3000；自定义端口时设置 BACKUP_APP_URL，不再用公网 HTTPS 端口判断停机状态。

## 项目库与 PDF 提问升级

2026-10-11 版本新增独立同步 worker、私有 GitHub 项目版本及 PDF 页码问题。部署见 [完整升级说明](upgrade-projects.md)，接入见 [GitHub 配置](github-setup.md)。本文描述的是新版备份行为；旧发布目录中的旧 backup 脚本不具备项目任务与 worker 一致性保护，不再用旧脚本备份已升级的网站。

## 账号恢复与邮件诊断补充

忘记超级管理员密码且邮件不可用时，按 [账号恢复说明](account-recovery.md) 使用交互式离线工具。恢复前停止网站与项目 worker，数据库备份、密码更新、旧会话和重置令牌撤销均由工具处理；不会通过修改初始化配置覆盖已有账号。
