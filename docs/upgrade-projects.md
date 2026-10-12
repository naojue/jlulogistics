# 2026-10-11：专业项目库与 PDF 按页提问升级

这份文档是已有单实例网站的部署交付说明。只有将新发布包传到服务器、运行升级并完成下面的 GitHub 和 Nginx 配置后，线上功能才全部可用。线上网站和本地工作目录是两份独立代码。示例中的主机名及目录需要按实际部署填写。

## 本次范围

- 专业项目列表、搜索、课程 / 标签筛选、介绍、代码目录、README、版本和成员讨论。
- 源码 ZIP 经网站导入专用 GitHub 组织中的私有仓库，固定提交对应每个版本；作者和管理员更新，失败保留既有已发布版本。
- 项目 ZIP 与全部解包内容分别不超过 200×1024×1024 字节，单文件不超过 100MiB、最多 1000 条目；资料及讨论图片保持 50MB。
- PDF 当前页与全部问题、跳页、两层带图回复、标记解决 / 重开。提问绑定具体文件和真实页码，普通旧评论保留。
- 所有私有读取仍要求验证邮箱、审批通过、账号可用及完成初始改密。

新增迁移 `20261011000000_projects_questions` 增加项目、任务、版本、讨论和 PDF 问题相关表及可空的 PDF 页数记录，不重置原账号、不移动既有资料或图片。升级脚本不运行 seed，不改变 SMTP、域名证书、VPN、firewalld 或现有 Nginx 配置。

## 服务器条件

适用于目前的 AlmaLinux 9、Node 24、SQLite、systemd `zhiye`、`/opt/zhiye` 部署；同时支持 `/opt/zhiye` 已经是旧发布目录软链接的情况。数据库和私有图片必须使用代码目录外的绝对持久路径，例如 `/var/lib/zhiye/community.db` 和 `/var/lib/zhiye/files`。

新的临时包目录默认 `/var/lib/zhiye/project-tasks`，权限 700。最多两个待处理包，每个预留 ZIP 加解包共 400MiB。升级前需要至少 2GiB 供依赖准备，随后还会检查“完整数据库、文件与待同步包备份所需空间 + 3GiB 构建 / 临时余量”。已有 2.5GiB swap 可继续使用；构建需几分钟，旧站在准备阶段继续运行。

## 上传并升级

在仓库根目录运行 Windows PowerShell：

```powershell
$serverIp = Read-Host "请输入服务器公网 IP 或 SSH 主机名"
scp ".\releases\zhiye-source-20261011-projects.tar.gz" ".\releases\zhiye-source-20261011-projects.tar.gz.sha256" ".\releases\upgrade-server-projects.sh" "root@${serverIp}:/root/"
```

服务器 root 终端：

```bash
bash /root/upgrade-server-projects.sh
```

脚本校验发布包、在独立目录安装依赖和构建，然后停止网站及已有项目 worker，以新版备份脚本保存数据库、图片和待同步包。成功备份后迁移、切换 `/opt/zhiye` 链接，创建独立 `zhiye-project-worker` 服务，启动并检查首页及项目列表。

如果 worker 被强制结束，最后一次租约可能需要约两分钟过期；脚本只对这个临时阻塞重试，不强行删除租约。其他备份错误立即取消升级。出现两个 active 和 `Code upgrade complete` 表示代码与服务内部检查通过；还需完成下面两项配置。

原代码或原软链接保存到输出的 `previous-...` 路径。升级前的本地备份在新发布目录的 `backups/<时间>`，脚本会输出新发布目录；复制到本机另存。原 `.env` 被安全复制到新发布目录，缺少临时目录配置时补充默认绝对路径。

## 仅给项目上传增加 Nginx 限额

脚本保留 Nginx 原样，避免猜错文件或影响同服务器的 3x-ui。先找出负责主域名 HTTPS 的配置：

```bash
nginx -T 2>&1 | awk '/^# configuration file / {file=$0} /server_name/ {print file; print $0}'
```

下面用 `/etc/nginx/conf.d/zhiye.conf` 举例；实际输出如果是 `zhiye-domain.conf` 等其他文件，改用那个真实文件。找到 `server_name` 对应实际主域名、监听 HTTPS 443 且代理到 `127.0.0.1:3000` 的 `server { ... }`。不要编辑 `www` 重定向块、旧 IP 站点或其他服务的配置。

先备份原文件，再用编辑器修改，不要覆盖整个配置：

```bash
cp -a /etc/nginx/conf.d/zhiye.conf /root/zhiye-nginx-before-projects.conf
nano /etc/nginx/conf.d/zhiye.conf
```

在上述主域名 HTTPS 的 `server` 内，原有 `location / { ... }` 的外面，新增下面一个完整位置。保留原来的证书、HTTP 验证目录、转发规则和资料上传限额；如果已存在同名精确位置，修改它，不新增重复块。

```nginx
location = /api/projects {
    client_max_body_size 210m;
    client_body_timeout 900s;
    proxy_connect_timeout 10s;
    proxy_read_timeout 900s;
    proxy_send_timeout 900s;
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_pass http://127.0.0.1:3000;
}
```

210m 给 200MiB 项目文件留出 multipart 开销，应用仍按实际字节检查 200MiB。其他资料和图片接口仍执行原 50MB 限制。关闭此位置的请求缓冲，减少 Nginx 与网站重复落盘。先检查，只有检查成功再重新加载：

```bash
nginx -t
systemctl reload nginx
```

检查失败时不要 reload，修正刚增加的位置或放回备份文件后再次检查。没有完成此步骤时，超过原代理上限的项目会出现 413，但普通资料和小项目不受该新增限额影响。

## 连接 GitHub

按 [GitHub 组织与应用配置](github-setup.md) 创建免费专用组织、组织拥有的 GitHub App，并把 ID 与私钥路径放在服务器 `.env`。网站安装令牌不交给浏览器，同学无需 GitHub 账号。

尚未配置 GitHub 时，可以先升级并使用 PDF 按页提问；项目发布页会提示管理员完成接入，不应把它当作已经可以同步到真实 GitHub。配置后重启 `zhiye` 和 `zhiye-project-worker`。

## 线上验收

1. 旧账号可以登录，原资料下载、预览及带图讨论仍正常。
2. 登录后打开 PDF，分别在不同页提问；切换当前页 / 全部问题，跳页、带图回复、解决并重开。退出后不能读私有问题或图片。
3. 上传一个小代码 ZIP，看到同步完成；私有仓库被创建，目录、代码和项目下载正常。再上传新版本，旧版本保持可读。
4. 上传超过 50MB 但不超过 200MB 的合法项目确认 Nginx 新位置生效。资料区仍不接受超过 50MB 的文件。
5. 项目删除后旧文件、下载、讨论与图片入口失效；成功同步任务的暂存目录被清理。
6. 重启两个本站服务后账号、版本和问题仍保留。项目 worker 的任务状态和租约支持中断恢复，远端提交不会重复发布为多个版本。

这些是部署后的人工验收步骤，本地测试结果不能替代真实服务器和真实 GitHub 授权确认。

## 回退与备份

失败脚本会尝试恢复原 `/opt/zhiye` 链接 / 目录及原 worker unit、启用状态和运行状态。迁移是增加结构，回退代码不自动覆盖数据库；新内容会留在数据库，旧代码暂时不展示。

断电或强制结束无法执行 EXIT 恢复。先停止 `zhiye` 与 `zhiye-project-worker`，检查脚本输出的 stage、previous 路径和 `/opt/zhiye` 当前链接，再决定恢复原链接。不要未核对目标就删除发布目录。必须恢复数据时，使用同一次完整备份的数据库、图片和待同步包；恢复会丢弃备份后的变化。详细规则见 [运维与恢复](operations.md)。

本地备份不包含已经发布的 GitHub 源码。另行保留组织私有仓库及所有网站记录的提交；恢复时核对 `remote-projects.json` 与远端提交。不要只恢复 SQLite 就删除远端历史。
