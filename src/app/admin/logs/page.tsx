import { db } from "@/lib/db";
import { memberPage } from "@/lib/session";
import { date } from "@/lib/utils";
import { PageHeading, Pagination, EmptyState } from "@/components/common";
const labels: Record<string, string> = {
  CREATE_ADMIN_INVITATION: "创建管理员邀请",
  REVOKE_ADMIN_INVITATION: "撤销管理员邀请",
  ACTIVATE_ADMIN: "激活管理员",
  PROMOTE_ADMIN: "提升管理员",
  DEMOTE_ADMIN: "撤销管理员身份",
  OFFLINE_SUPER_ADMIN_PASSWORD_RESET: "服务器恢复超级管理员密码",
  MEMBER_ACTIVE: "批准成员",
  MEMBER_REJECTED: "拒绝申请",
  MEMBER_SUSPENDED: "停用成员",
  EDIT_RESOURCE: "编辑资料",
  DELETE_RESOURCE: "删除资料",
  EDIT_POST: "编辑帖子",
  DELETE_POST: "删除帖子",
  DELETE_COMMENT: "删除资料评论",
  DELETE_REPLY: "删除帖子回复",
  CREATE_TAXONOMY: "添加分类标签",
  EDIT_TAXONOMY: "修改分类标签",
  DELETE_TAXONOMY: "删除分类标签",
};
export default async function Logs({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await memberPage(true);
  const params = await searchParams;
  const count = await db.auditLog.count();
  const page = Math.min(
    Math.max(1, Math.trunc(Number(params.page) || 1)),
    Math.max(1, Math.ceil(count / 30)),
  );
  const logs = await db.auditLog.findMany({
    include: { actor: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * 30,
    take: 30,
  });
  return (
    <>
      <PageHeading
        eyebrow="A CLEAR RECORD OF EVERY DECISION"
        title="管理操作记录"
        description="保留操作人、目标、时间和原因，便于回溯管理决定。"
      />
      <div className="panel table-wrapper">
        {logs.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作人</th>
                <th>操作</th>
                <th>目标 / 原因</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>
                    {date(log.createdAt)}
                    <small>{log.createdAt.toLocaleTimeString("zh-CN")}</small>
                  </td>
                  <td>{log.actor.name}</td>
                  <td>{labels[log.action] || log.action}</td>
                  <td>
                    <small>{log.targetId}</small>
                    {log.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="还没有管理记录" />
        )}
      </div>
      <Pagination page={page} pages={Math.ceil(count / 30)} base="/admin/logs" />
    </>
  );
}
