# 将网站源码发布到 GitHub

这里发布的是网站程序本身，采用 MIT 许可证。网站内成员上传的资料、图片和私有专业项目继续遵循原成员权限，不随源码发布。

## 已准备的仓库内容

- README：项目介绍、功能、权限、技术栈、截图、启动和部署入口。
- LICENSE、CONTRIBUTING、SECURITY、CHANGELOG：许可证、贡献、安全报告与更新说明。
- `.github`：自动检查、问题报告、功能建议和 PR 模板。
- `.gitignore`、`.gitattributes`、`.editorconfig`：排除本地数据、统一换行和编辑规范。
- 源码、全部 Prisma 迁移、测试、依赖锁文件、公开环境模板和操作文档。

只提交 `.env.example`。真实配置、认证密钥、邮箱授权码、GitHub App 私钥、数据库、用户文件、备份和发布包不属于源码仓库。

## 1. 生成可分享的源码包

在项目根目录运行：

```shell
npm run package:github
```

输出为 `releases/zhiye-community-github.zip`，附 SHA-256 校验文件及清单。解压后顶层是 `zhiye-community` 文件夹。打包使用明确的源文件清单，排除运行数据、生成代码与线上社区截图；遇到符号链接或明显凭证格式会停止，只报告文件名。

发布前仍须确认自己后来新增的文档、图片和代码适合公开。源码包不携带数据库、用户内容或服务器凭据。

## 2. 创建 GitHub 空仓库

建议仓库名 `zhiye-community`，描述可用：

> 面向物流管理与计算机科学双学位的学习社区，支持资料预览、成员审批、GitHub 私有项目库和 PDF 按页讨论。

选择 Public。创建时将 README、`.gitignore` 和 License 保持未添加，使用本地已整理的文件，避免两份初始历史冲突。可以放到自己有维护权限的个人账号或组织；本仓库不需要绑定网站用于项目存储的 GitHub App。[GitHub 官方导入说明](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)

创建后复制仓库的 HTTPS 地址，类似 `https://github.com/OWNER/zhiye-community.git`。`OWNER` 必须换成实际账号或组织。

## 3. 提交与推送（Windows PowerShell）

进入刚解压得到的 `zhiye-community` 文件夹，在文件夹空白处打开终端。

先建立本地仓库，配置本仓库使用的作者名和提交邮箱；邮箱可使用 GitHub Settings → Emails 中提供的 noreply 地址：

```powershell
git init -b main
$commitName = Read-Host "请输入提交作者名"
$commitEmail = Read-Host "请输入 GitHub 提交邮箱或 noreply 地址"
git config user.name $commitName
git config user.email $commitEmail
git add .
git status --short
```

确认清单是代码与文档，没有 `.env`、私钥、数据库或用户资料，再创建首次提交：

```powershell
git commit -m "chore: prepare initial open source release"
```

最后输入刚创建的仓库地址并推送：

```powershell
$repositoryUrl = (Read-Host "请粘贴 GitHub 仓库的 HTTPS 地址").Trim()
git remote add origin $repositoryUrl
git push -u origin main
```

首次推送通常由 Git Credential Manager 引导浏览器登录和授权。网站的 GitHub App 私钥是服务端项目存储凭据，不用于这个操作，也不放进远端地址。[GitHub 认证说明](https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git)

如果已用 Git 管理这个目录，保留现有历史；从 `git status` 检查状态，按已有远端设置执行，不重新建立初始提交。已有远端不使用 `remote add` 重复添加。

## 4. 发布后确认

- 首页显示项目介绍、相对截图和 MIT 许可证。
- Actions 中 CI 能完成类型生成、类型检查、Vitest 和构建；首次远端执行的结果以 GitHub 页面为准。
- `.env.example` 可见，实际 `.env`、密钥、数据库与用户内容不可见。
- 仓库描述和 Topics 可填写 `nextjs`、`typescript`、`learning-community`、`logistics`、`prisma`、`sqlite`。

本次整理不会自动创建远端仓库、推送或部署。日常开发可直接在正式克隆的仓库中继续；生成源码包只是分享快照，后续版本仍通过 Git 提交维护。
