# 退出登录修复（2026-10-12）

线上匿名请求已确认：不带请求体的 `POST /api/auth/sign-out` 返回 415，错误码 `UNSUPPORTED_MEDIA_TYPE`；使用 `Content-Type: application/json` 和 `{}` 返回 200。旧按钮只在成功时处理页面变化，没有失败提示。

修复请求格式，成功后重新加载首页，退出期间显示处理中；HTTP 与网络失败提供中文提示和重试。四项隔离浏览器验收覆盖账户页、首页、旧会话失效、私有入口拒绝访问、失败输入保留和重试。

2026-10-12，用户已在服务器执行补丁，校验、生产构建与类型检查通过，输出 `SIGN_OUT_UPDATE_OK`。备份目录为 `/opt/zhiye-sign-out-backups/20261012T020138Z-405050`。服务重启初期有一次本地连接拒绝，后续重试通过健康检查。随后核对公网首页返回 200，公开脚本已包含 JSON 退出请求、成功后重新加载首页、处理中状态与失败提示；登录后的实际退出仍需在浏览器中确认。

运行 `node scripts/package-sign-out-release.mjs` 生成独立补丁。只包含 `src/components/sign-out.tsx` 和独立的样式模块，沿用现有更新脚本的备份、部署锁与失败回退；不需要数据库迁移或重新初始化。构建期间网站会暂时停止。

在 Windows PowerShell 上传：

```powershell
$serverIp = Read-Host "请输入服务器公网 IP 或 SSH 主机名"
scp ".\releases\fix-sign-out-20261012.sh" ".\releases\fix-sign-out-20261012.sh.sha256" "root@${serverIp}:/root/"
```

然后在服务器终端执行：

```bash
cd /root
sha256sum --check fix-sign-out-20261012.sh.sha256
bash /root/fix-sign-out-20261012.sh
```

脚本默认检查 `/opt/zhiye`、`zhiye` 服务及原构建，备份放在 `/opt/zhiye-sign-out-backups`。构建或健康检查失败时还原原组件与原构建并启动旧服务。可先用 `bash /root/fix-sign-out-20261012.sh --check` 检查兼容性。

看到 `SIGN_OUT_UPDATE_OK` 后，刷新网站，分别从资料库和成员中心点击退出；应返回资料库并出现“登录”，重新访问成员中心应进入登录页。浏览器网络面板应看到退出接口 200。请求失败时应显示中文提示并允许再次点击。
