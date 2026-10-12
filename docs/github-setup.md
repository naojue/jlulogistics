# 专业项目库：创建 GitHub 组织并连接服务器

这份说明用于新版代码准备完成之后的真实接入。开发和浏览器测试使用隔离模拟服务，不代表已经连接真实 GitHub。你已有个人账号，无需再注册一个共享个人账号；同学继续使用网站账号。

## 1. 新建专用组织

登录自己的 GitHub，在头像菜单进入 Settings → Organizations → New organization。选择 GitHub Free，填写组织名和联系邮箱，按页面提示完成。组织名可以与域名接近，但必须以 GitHub 实际接受的名字为准。组织可使用免费方案，私有仓库的部分高级功能有限；本网站不依赖这些高级功能。[创建步骤](https://docs.github.com/en/organizations/collaborating-with-groups-in-organizations/creating-a-new-organization-from-scratch)、[组织方案说明](https://docs.github.com/en/organizations/collaborating-with-groups-in-organizations/about-organizations)。

组织只存放本站的专业项目，暂时不用邀请同学加入组织。保存组织名，例如 `your-study-projects`；网站会自动创建 `zhiye-project-项目ID` 私有仓库，不用手工为每位同学建仓库。

## 2. 在组织名下创建 GitHub App

进入 Your organizations → 新组织的 Settings → Developer settings → GitHub Apps → New GitHub App。App 必须由这个组织拥有，后面的 Only on this account 才对应这个组织。[官方注册说明](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)。

填写建议：

- GitHub App name：填写一个未被占用的应用名，如组织名加 `-website`。
- Homepage URL：填写实际网站地址，例如 `https://community.example.org`。
- Callback URL、Setup URL 留空；不启用 OAuth 用户授权或 Device Flow，本网站不使用 GitHub 登录。
- Webhook 取消 Active，不接收事件，不需要 Webhook URL 或 secret。
- Where can this GitHub App be installed：Only on this account。

Repository permissions 使用以下最小权限，其他权限保持 No access：

| 权限                | 设置                    | 用途                                     |
| ------------------- | ----------------------- | ---------------------------------------- |
| Repository creation | Read and write / write  | 自动创建项目仓库                         |
| Contents            | Read and write          | 写入源码、提交和任务分支；读取代码及下载 |
| Metadata            | Read-only，通常自动保留 | 读取仓库基本信息                         |

GitHub 当前提供专门的 Repository creation 权限，它比 Administration 更窄；本网站无需修改仓库设置、删除仓库或管理协作者，因此不用授予 Administration。也不用授予 Actions、Workflows、Secrets、Members 或 Issues 权限。[官方最小权限说明](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)、[创建组织仓库的权限要求](https://docs.github.com/en/rest/repos/repos#create-an-organization-repository)。

Create GitHub App 后，在应用设置中记录数字 **App ID**。进入 Credentials → Key pairs → New key 生成并下载 `.pem` 私钥；旧版界面是在 Private keys 中点击 Generate a private key。不要把私钥、GitHub 密码、token 或服务器 `.env` 发到聊天中；也不要把它们上传进专业项目。

## 3. 安装到这个组织

在应用设置选择 Install App，安装位置选择刚建立的专用组织。这个组织只存本站项目，可以选择 All repositories，使网站能读取后续自动创建的仓库。不要安装到存有个人其他项目的账号。GitHub 也支持限制到选择的仓库，并自动授权 App 自己创建的仓库。[安装说明](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app)。

完成后在组织的 Installed GitHub Apps 中 Configure 此 App，浏览器地址通常含 `/installations/数字`，该数字就是 **Installation ID**。记录它，注意不能拿 App ID 代替。

## 4. 安全放入服务器配置

Windows PowerShell 上传刚下载的私钥。运行后，在提示出现时输入服务器地址和实际文件的完整路径；从资源管理器“复制为路径”取得的外层双引号会自动去掉：

```powershell
$serverIp = Read-Host "请输入服务器公网 IP 或 SSH 主机名"
$keyFile = (Read-Host "请输入下载的 GitHub App 私钥文件完整路径").Trim().Trim('"')
if (-not (Test-Path -LiteralPath $keyFile -PathType Leaf)) { throw "没有找到私钥文件，请检查路径。" }
scp $keyFile "root@${serverIp}:/root/zhiye-github-app.pem"
```

在服务器 root 终端安装到私有位置：

```bash
install -o zhiye -g zhiye -m 600 /root/zhiye-github-app.pem /var/lib/zhiye/github-app.pem
nano /opt/zhiye/.env
```

保留原数据库、邮箱、管理员和网站配置，只新增或更新这五行，将示例值换成自己保存的值：

```dotenv
PROJECT_TEMP_DIR="/var/lib/zhiye/project-tasks"
GITHUB_ORGANIZATION="你的组织名"
GITHUB_APP_ID="你的数字AppID"
GITHUB_INSTALLATION_ID="你的数字InstallationID"
GITHUB_PRIVATE_KEY_PATH="/var/lib/zhiye/github-app.pem"
```

保存后确保权限并重启两个本站服务：

```bash
chown zhiye:zhiye /opt/zhiye/.env
chmod 600 /opt/zhiye/.env
systemctl restart zhiye zhiye-project-worker
systemctl is-active zhiye zhiye-project-worker
```

`GITHUB_PRIVATE_KEY_PATH` 是文件路径，不能直接粘贴整段 PEM。网站通过私钥自动签名并换取短期安装令牌，不需要把长期 token 放入配置。安装令牌在服务器内缓存并自动更新。[安装令牌说明](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)。生产环境不要设置 `E2E_RUN` 或 `GITHUB_TEST_API_URL`。

私钥另外保存在自己控制的安全备份中。确认私有目录里的新文件可以被 `zhiye` 用户读取以后，再处理 `/root` 的临时上传副本；不要把密钥放到网站公开目录。

## 5. 确认首次真实同步

先完成 [升级说明](upgrade-projects.md) 中的 Nginx 专用上传位置，然后登录网站，上传一个很小的测试项目 ZIP（README 加一份代码即可）。

确认网站从“等待同步”变为“已完成”，项目目录、代码和下载可用；到组织查看自动生成的仓库，必须显示 Private。再上传一个新版本，确认历史版本可读；退出网站后，私有文件和讨论应无法访问。服务器临时目录成功任务会清理，数据库和 GitHub 里的版本仍保留。

如果失败，网站会显示中文状态，查看 `journalctl -u zhiye-project-worker -n 50 --no-pager` 中本站服务的通用错误信息。先核对组织名、两个不同的 ID、应用安装位置和三项权限。变更 App 权限后，需要在组织安装设置接受新权限。不要把配置或私钥打印出来排错。

项目在后台同步，可以离开页面，稍后从“我的项目”查看结果。为保守遵守 GitHub 内容写入限制，真实请求使用共享的 8 秒写入间隔；1000 个全新小文件仅这个节流预算就约需 2.2 小时，实际还受网络影响。相同内容的文件会复用远端对象，重试不会从头重复写入已经保存的文件。收到限流时遵循响应冷却时间，网站显示可重试状态，不反复立即发送同一失败任务。

官方给出的通用内容创建限额为每分钟 80 次、每小时 500 次，但没有逐一说明 blob 的计数，当前把 blob 也计入是保守实现；部分接口可能有更低或动态限制，不能保证永不限流。[GitHub 限流说明](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)、[请求最佳实践](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)。

## 6. 存储与备份边界

200MB 是单次项目包及全部解包内容的上限，单文件仍限 100MiB。代码保存到 GitHub 后不在服务器长期留存，图片和讨论仍存服务器。项目包的依赖、编译产物、明显密钥文件及工作流不会导入，但作者仍需检查代码中没有硬编码的密码或私人数据。

GitHub 里的私有源码也需要另外备份。网站本地备份只包含项目介绍、版本及提交清单、讨论、图片和尚未同步的项目包；见 [备份恢复说明](operations.md)。保留任务分支与对应提交，不要手工删除 `zhiye-task-*` 分支或重写历史，否则网站记录的历史版本可能失去远端来源。
