import Link from "next/link";
import { db } from "@/lib/db";
import { memberPage } from "@/lib/session";
import { PageHeading } from "@/components/common";
export default async function Admin() {
  await memberPage(true);
  const [pending, active, resources, posts] = await Promise.all([
    db.user.count({ where: { status: "PENDING", emailVerified: true, role: "MEMBER" } }),
    db.user.count({ where: { status: "ACTIVE" } }),
    db.resource.count({ where: { deletedAt: null } }),
    db.post.count({ where: { deletedAt: null } }),
  ]);
  return (
    <>
      <PageHeading
        eyebrow="TAKE CARE OF THE COMMUNITY"
        title="社区管理概览"
        description="审核成员申请，照看资料与讨论，让社区有序生长。"
      />
      <div className="admin-stats">
        {[
          [pending, "待审批成员", "/admin/members"],
          [active, "已激活账号", "/admin/members?status=ACTIVE"],
          [resources, "已发布资料", "/admin/resources"],
          [posts, "讨论帖子", "/admin/discussions"],
        ].map(([number, label, href]) => (
          <Link className="metric" key={label} href={String(href)}>
            <strong>{number}</strong>
            <small>{label} →</small>
          </Link>
        ))}
      </div>
      <div className="panel" style={{ marginTop: 24 }}>
        <h2>管理提示</h2>
        <p className="prose-text">
          邮箱验证完成的申请才可审批。成员内容发布后立即展示，你可以管理分类、编辑资料和帖子，或填写原因后删除不合适的内容。所有管理操作都会留有记录。
        </p>
      </div>
    </>
  );
}
