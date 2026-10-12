import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { date } from "@/lib/utils";
import { PageHeading } from "@/components/common";
import { ActionForm } from "@/components/action-form";
import { AuthForm } from "@/components/auth-form";
import { Button } from "@/components/ui/button";
import { profileAction, resubmitAction, redeemInvitationAction } from "@/app/actions";
import { myProjects } from "@/services/projects";
export default async function Account() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const latest = await db.application.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  if (user.mustChangePassword)
    return (
      <div className="narrow">
        <PageHeading
          eyebrow="A SECURE START"
          title="请修改初始密码"
          description="这是你的首次登录，修改密码后即可使用管理功能。"
        />
        <div className="panel">
          <AuthForm mode="password" />
        </div>
      </div>
    );
  const active = user.status === "ACTIVE" && user.emailVerified;
  const [resources, posts] = active
    ? await Promise.all([
        db.resource.findMany({
          where: { authorId: user.id, deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
        db.post.findMany({
          where: { authorId: user.id, deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
      ])
    : [[], []];
  const projects = active ? await myProjects(user) : [];
  return (
    <>
      <PageHeading
        eyebrow="YOUR LITTLE CORNER"
        title={`你好，${user.name}`}
        description="管理你的分享，也看看自己的学习足迹。"
      />
      <div className={`status-banner ${user.status.toLowerCase()}`}>
        <h3>
          {active
            ? "账号已激活，欢迎继续分享与交流"
            : user.status === "REJECTED"
              ? "你的加入申请未通过"
              : "邮箱已验证，正在等待管理员审批"}
        </h3>
        <p className="muted">
          {active
            ? `当前身份：${({ MEMBER: "社区成员", ADMIN: "管理员", SUPER_ADMIN: "超级管理员" } as Record<string, string>)[user.role]}`
            : user.status === "REJECTED"
              ? `原因：${latest?.reason || "请联系管理员"}`
              : "审批通过后，即可下载资料、上传分享和参与讨论。"}
        </p>
      </div>
      {user.status === "REJECTED" && (
        <div className="panel narrow">
          <h2>补充说明，重新申请</h2>
          <ActionForm action={resubmitAction}>
            <label>
              申请说明
              <textarea
                name="statement"
                required
                minLength={10}
                maxLength={1000}
                defaultValue={latest?.statement}
                rows={4}
              />
            </label>
            <div>
              <Button>重新提交申请</Button>
            </div>
          </ActionForm>
        </div>
      )}
      {active && (
        <div className="account-grid">
          <section className="panel">
            <h2>
              我的项目 <span className="muted">最近 20 个</span>
            </h2>
            <div className="simple-list">
              {projects.slice(0, 20).map((item) => (
                <Link key={item.id} href={`/projects/${item.id}`}>
                  <span>{item.title}</span>
                  <small>
                    {item.currentVersionId ? "已发布" : "尚未发布"} · {date(item.createdAt)}
                  </small>
                </Link>
              ))}
            </div>
            {!projects.length && (
              <p className="muted">
                你还没有发布项目。
                <Link href="/projects/new" className="text-link">
                  分享一个项目
                </Link>
              </p>
            )}
          </section>
          <section className="panel">
            <h2>
              我的资料 <span className="muted">最近 20 份</span>
            </h2>
            <div className="simple-list">
              {resources.map((item) => (
                <Link key={item.id} href={`/resources/${item.id}`}>
                  <span>{item.title}</span>
                  <small>{date(item.createdAt)}</small>
                </Link>
              ))}
            </div>
            {!resources.length && (
              <p className="muted">
                你还没有上传资料。
                <Link href="/upload" className="text-link">
                  开始分享
                </Link>
              </p>
            )}
          </section>
          <section className="panel">
            <h2>
              我的讨论 <span className="muted">最近 20 篇</span>
            </h2>
            <div className="simple-list">
              {posts.map((item) => (
                <Link key={item.id} href={`/forum/${item.id}`}>
                  <span>{item.title}</span>
                  <small>{date(item.createdAt)}</small>
                </Link>
              ))}
            </div>
            {!posts.length && (
              <p className="muted">
                你还没有发起讨论。
                <Link href="/forum/new" className="text-link">
                  分享想法
                </Link>
              </p>
            )}
          </section>
        </div>
      )}
      <div className="account-grid">
        <section className="panel">
          <h2>个人资料</h2>
          <p className="muted" style={{ marginBottom: 17 }}>
            注册邮箱：{user.email}
          </p>
          <ActionForm action={profileAction}>
            <label>
              昵称
              <input name="name" defaultValue={user.name} required minLength={2} maxLength={30} />
            </label>
            <div>
              <Button variant="outline">保存昵称</Button>
            </div>
          </ActionForm>
        </section>
        <section className="panel">
          <h2>修改密码</h2>
          <AuthForm mode="password" />
        </section>
      </div>
      {user.role === "MEMBER" && (
        <div className="panel">
          <h2>我收到了管理员邀请</h2>
          <ActionForm action={redeemInvitationAction}>
            <label>
              管理员邀请码
              <input
                name="token"
                required
                maxLength={100}
                placeholder="邀请码必须绑定你的注册邮箱"
              />
            </label>
            <div>
              <Button variant="outline">验证并激活管理员权限</Button>
            </div>
          </ActionForm>
        </div>
      )}
    </>
  );
}
