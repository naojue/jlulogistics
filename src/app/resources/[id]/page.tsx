import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, LockKeyhole, FileText } from "lucide-react";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { publicResourceSelect } from "@/services/resources";
import { discussionItems } from "@/services/discussions";
import { date, fileSize } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Discussion } from "@/components/discussion";
import { ActionForm } from "@/components/action-form";
import { resourceDeleteAction } from "@/app/actions";
import { FilePreview } from "@/components/file-preview";
export default async function ResourceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [item, user] = await Promise.all([
    db.resource.findFirst({ where: { id, deletedAt: null }, select: publicResourceSelect }),
    currentUser(),
  ]);
  if (!item) notFound();
  const member =
    !!user && user.emailVerified && user.status === "ACTIVE" && !user.mustChangePassword;
  const admin = member && ["ADMIN", "SUPER_ADMIN"].includes(user!.role);
  const canEdit = member && (admin || item.authorId === user!.id);
  const comments = member ? await discussionItems(user!, "RESOURCE", id) : [];
  return (
    <div className="narrow">
      <Link className="back-link" href="/">
        <ArrowLeft size={15} />
        返回资料库
      </Link>
      <article className="panel">
        <div className="tabs">
          <span className={`badge ${item.area === "ADMIN" ? "badge-admin" : "badge-member"}`}>
            {item.area === "ADMIN" ? "管理员资料" : "成员分享"}
          </span>
          <span className="muted">{item.category.name}</span>
        </div>
        <h1 className="detail-title">{item.title}</h1>
        <div className="detail-meta">
          <span className="avatar avatar-small">{item.author.name.slice(0, 1)}</span>
          <span>{item.author.name}</span>
          <span>发布于 {date(item.createdAt)}</span>
          {canEdit && (
            <Link className="text-link push-right" href={`/resources/${id}/edit`}>
              编辑资料
            </Link>
          )}
        </div>
        <p className="prose-text">{item.description}</p>
        <div className="tag-list">
          {item.tags.map((tag) => (
            <span className="tag" key={tag.id}>
              {tag.name}
            </span>
          ))}
        </div>
        {member ? (
          <FilePreview
            resourceId={id}
            files={[item.file, ...item.attachments.map((attachment) => attachment.file)]}
          />
        ) : (
          <div className="download-box">
            <FileText size={27} color="#83a78d" />
            <div className="file-info">
              <strong>{item.file.name}</strong>
              <small>
                {item.attachments.length + 1} 个文件 ·{" "}
                {fileSize(
                  item.file.size +
                    item.attachments.reduce((total, attachment) => total + attachment.file.size, 0),
                )}{" "}
                · 仅审批通过的成员可预览和下载
              </small>
            </div>
            <Button asChild>
              <a href={member ? `/api/resources/${id}/download` : user ? "/account" : "/login"}>
                {member ? <Download size={16} /> : <LockKeyhole size={16} />}
                {member ? "下载资料" : "登录并通过审批后下载"}
              </a>
            </Button>
          </div>
        )}
        {canEdit && (
          <details className="danger-details">
            <summary>删除这份资料</summary>
            <ActionForm action={resourceDeleteAction}>
              <input type="hidden" name="id" value={id} />
              {item.authorId !== user!.id && (
                <label>
                  删除原因
                  <input name="reason" minLength={2} maxLength={500} required />
                </label>
              )}
              <p className="muted">删除后资料及其讨论将不再展示，旧下载入口也会失效。</p>
              <div>
                <Button variant="destructive" size="sm">
                  确认删除资料
                </Button>
              </div>
            </ActionForm>
          </details>
        )}
      </article>
      {member ? (
        <Discussion kind="RESOURCE" id={id} items={comments} userId={user!.id} admin={admin} />
      ) : (
        <div className="panel locked-box">
          <LockKeyhole size={24} />
          <h3>学习讨论，留给社区里的伙伴</h3>
          <p className="muted">登录并通过成员审批后，可以查看评论和参与交流。</p>
          <Button asChild variant="outline">
            <Link href={user ? "/account" : "/register"}>
              {user ? "查看申请状态" : "申请加入社区"}
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
