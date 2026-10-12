import { db } from "@/lib/db";
import { memberPage } from "@/lib/session";
import { PageHeading, Pagination, EmptyState } from "@/components/common";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { reviewAction } from "@/app/actions";
const statusLabels: Record<string, string> = {
  PENDING: "待审批",
  ACTIVE: "已激活",
  REJECTED: "已拒绝",
  SUSPENDED: "已停用",
};
export default async function Members({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await memberPage(true);
  const params = await searchParams;
  const status = ["PENDING", "ACTIVE", "REJECTED", "SUSPENDED"].includes(params.status || "")
    ? params.status
    : undefined;
  const where = {
    role: "MEMBER",
    ...(status ? { status } : {}),
    ...(params.q
      ? {
          OR: [
            { email: { contains: params.q.slice(0, 100) } },
            { name: { contains: params.q.slice(0, 100) } },
          ],
        }
      : {}),
  };
  const count = await db.user.count({ where });
  const page = Math.min(
    Math.max(1, Math.trunc(Number(params.page) || 1)),
    Math.max(1, Math.ceil(count / 20)),
  );
  const users = await db.user.findMany({
    where,
    include: { applications: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * 20,
    take: 20,
  });
  return (
    <>
      <PageHeading
        eyebrow="MEMBERS & APPLICATIONS"
        title="成员审批与管理"
        description="未验证邮箱的申请不能通过审批；停用成员会立即撤销其会话。"
      />
      <form className="filter-bar">
        <input
          name="q"
          defaultValue={params.q}
          aria-label="搜索成员"
          placeholder="搜索昵称或邮箱"
        />
        <select name="status" defaultValue={status || ""} aria-label="成员状态">
          <option value="">全部状态</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
        <Button variant="outline">筛选</Button>
      </form>
      <div className="panel table-wrapper">
        {users.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>成员 / 申请说明</th>
                <th>账号状态</th>
                <th>审批与管理</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <strong>{user.name}</strong>
                    <small>{user.email}</small>
                    <p className="statement">
                      {user.applications[0]?.statement || user.applicationStatement}
                    </p>
                    {user.applications[0]?.reason && (
                      <p className="statement">处理原因：{user.applications[0].reason}</p>
                    )}
                  </td>
                  <td>
                    <span className={`status-pill status-${user.status}`}>
                      {statusLabels[user.status]}
                    </span>
                    <small>{user.emailVerified ? "邮箱已验证" : "邮箱未验证"}</small>
                  </td>
                  <td key={user.status}>
                    {user.status === "PENDING" && user.emailVerified ? (
                      <ActionForm action={reviewAction} className="mini-form">
                        <input type="hidden" name="id" value={user.id} />
                        <input
                          name="reason"
                          placeholder="拒绝时填写原因"
                          maxLength={500}
                          aria-label="拒绝原因"
                        />
                        <Button size="sm" name="decision" value="ACTIVE">
                          通过审批
                        </Button>
                        <Button size="sm" variant="destructive" name="decision" value="REJECTED">
                          拒绝
                        </Button>
                      </ActionForm>
                    ) : user.status === "ACTIVE" ? (
                      <ActionForm action={reviewAction} className="mini-form">
                        <input type="hidden" name="id" value={user.id} />
                        <input type="hidden" name="decision" value="SUSPENDED" />
                        <input
                          name="reason"
                          placeholder="停用原因"
                          minLength={2}
                          maxLength={500}
                          required
                          aria-label="停用原因"
                        />
                        <Button size="sm" variant="destructive">
                          停用成员
                        </Button>
                      </ActionForm>
                    ) : (
                      <span className="muted">
                        {user.status === "PENDING" ? "等待用户验证邮箱" : "无待处理操作"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="没有匹配的成员" description="新的成员申请会出现在这里。" />
        )}
      </div>
      <Pagination page={page} pages={Math.ceil(count / 20)} base="/admin/members" query={params} />
    </>
  );
}
