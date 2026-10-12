import { db } from "@/lib/db";
import { memberPage } from "@/lib/session";
import { date } from "@/lib/utils";
import { PageHeading, Pagination } from "@/components/common";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { invitationAction, revokeInvitationAction, adminRoleAction } from "@/app/actions";
export default async function Administrators({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await memberPage(true, true);
  const params = await searchParams;
  const [admins, invites] = await Promise.all([
    db.user.findMany({
      where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } },
      orderBy: { createdAt: "asc" },
    }),
    db.adminInvitation.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const where = {
    role: "MEMBER",
    status: "ACTIVE",
    emailVerified: true,
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
  const members = await db.user.findMany({ where, skip: (page - 1) * 20, take: 20 });
  return (
    <>
      <PageHeading
        eyebrow="TRUSTED PEOPLE. CLEAR RESPONSIBILITY."
        title="管理员与邀请"
        description="只有超级管理员可以管理管理员；邀请七天有效，绑定邮箱且只能使用一次。"
      />
      <div className="account-grid">
        <section className="panel">
          <h2>生成管理员邀请码</h2>
          <ActionForm action={invitationAction}>
            <label>
              绑定邮箱
              <input name="email" type="email" required placeholder="invitee@example.com" />
            </label>
            <Button>生成邀请码与链接</Button>
          </ActionForm>
        </section>
        <section className="panel">
          <h2>直接添加新管理员</h2>
          <ActionForm action={invitationAction}>
            <input type="hidden" name="deliver" value="true" />
            <label>
              新管理员邮箱
              <input name="email" type="email" required placeholder="new-admin@example.com" />
            </label>
            <Button>发送管理员激活邮件</Button>
            <p className="inline-note">收件人自行设置密码并验证邮箱，无需再次审批。</p>
          </ActionForm>
        </section>
      </div>
      <section className="panel table-wrapper">
        <h2>管理员名单</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>账号</th>
              <th>身份</th>
              <th>管理</th>
            </tr>
          </thead>
          <tbody>
            {admins.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.name}</strong>
                  <small>{user.email}</small>
                </td>
                <td>{user.role === "SUPER_ADMIN" ? "超级管理员" : "管理员"}</td>
                <td>
                  {user.role === "ADMIN" ? (
                    <ActionForm action={adminRoleAction} className="mini-form">
                      <input type="hidden" name="id" value={user.id} />
                      <input type="hidden" name="promote" value="false" />
                      <Button size="sm" variant="destructive">
                        撤销管理员身份
                      </Button>
                    </ActionForm>
                  ) : (
                    <span className="muted">初始化账号受保护</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel table-wrapper">
        <h2>将已有成员提升为管理员</h2>
        <form className="filter-bar">
          <input
            name="q"
            defaultValue={params.q}
            placeholder="搜索成员昵称或邮箱"
            aria-label="搜索成员"
          />
          <Button variant="outline">搜索</Button>
        </form>
        <table className="data-table">
          <thead>
            <tr>
              <th>成员</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {members.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.name}</strong>
                  <small>{user.email}</small>
                </td>
                <td>
                  <ActionForm action={adminRoleAction} className="mini-form">
                    <input type="hidden" name="id" value={user.id} />
                    <input type="hidden" name="promote" value="true" />
                    <Button size="sm" variant="outline">
                      提升为管理员
                    </Button>
                  </ActionForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!members.length && <p className="muted">暂无符合条件的成员。</p>}
        <Pagination
          page={page}
          pages={Math.ceil(count / 20)}
          base="/admin/administrators"
          query={params}
        />
      </section>
      <section className="panel table-wrapper">
        <h2>
          邀请记录 <span className="muted">最近 100 条</span>
        </h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>绑定邮箱</th>
              <th>有效期</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {invites.map((invite) => (
              <tr key={invite.id}>
                <td>{invite.email}</td>
                <td>{date(invite.expiresAt)}</td>
                <td>
                  {invite.usedAt
                    ? "已使用"
                    : invite.revokedAt
                      ? "已撤销"
                      : invite.expiresAt < new Date()
                        ? "已过期"
                        : "有效"}
                </td>
                <td>
                  {!invite.usedAt && !invite.revokedAt && invite.expiresAt > new Date() && (
                    <ActionForm action={revokeInvitationAction} className="mini-form">
                      <input type="hidden" name="id" value={invite.id} />
                      <Button variant="destructive" size="sm">
                        撤销邀请
                      </Button>
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
