<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 知页项目约束

- 先阅读 `docs/requirements.md` 和 `docs/architecture.md`，以权限矩阵为准。
- 页面、服务端入口、业务服务、基础设施分层；权限检查在服务端执行。
- 邮箱验证、成员审批、管理员邀请是独立流程。注册不得接收角色或审批结果。
- 公开资料 DTO 不得包含邮箱、私有存储键或内部讨论；上传文件不得放入 public。
- 所有角色或状态变更都要检查当前数据库状态；停用、角色变化、密码重置要撤销相关会话。
- 不读取或打印 `.env` 的密码和认证密钥。测试使用隔离数据库，不修改正常社区数据。
- 按改动运行 `npm run typecheck`、相关测试与构建；业务表单失败时保留输入。
- 新增功能或改变权限规则时同步更新需求与对应验收测试。
