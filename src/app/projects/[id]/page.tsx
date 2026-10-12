import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { currentUser } from "@/lib/session";
import { AppError } from "@/lib/policy";
import { date } from "@/lib/utils";
import { projectDetail } from "@/services/projects";
import { deleteProjectAction } from "@/app/project-actions";
import { ActionForm } from "@/components/action-form";
import { ProjectBrowser } from "@/components/project-browser";
import { ProjectDiscussion } from "@/components/project-discussion";
import { ProjectSyncStatus } from "@/components/project-sync-status";
import { Button } from "@/components/ui/button";

export default async function ProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  const item = await projectDetail(user, id).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  if (!item) notFound();
  const admin = item.member && !!user && ["ADMIN", "SUPER_ADMIN"].includes(user.role);
  return (
    <div className="project-detail">
      <Link className="back-link" href="/projects">
        <ArrowLeft size={15} />
        返回项目库
      </Link>
      <article className="panel">
        <span className="badge badge-member">{item.course}</span>
        <h1 className="detail-title">{item.title}</h1>
        <div className="detail-meta">
          <span className="avatar avatar-small">{item.author.name.slice(0, 1)}</span>
          <span>{item.author.name}</span>
          <span>发布于 {date(item.createdAt)}</span>
          {item.canEdit && (
            <Link className="text-link push-right" href={`/projects/${id}/edit`}>
              编辑与更新项目
            </Link>
          )}
        </div>
        <p className="prose-text">{item.description}</p>
        <div className="tag-list">
          {item.tags
            .split(",")
            .filter(Boolean)
            .map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
        </div>
        {item.member && !item.configured && (
          <p className="inline-note">
            项目存储尚未接入，暂时不能读取或上传项目文件。项目介绍和现有讨论仍可查看。
          </p>
        )}
        {item.canEdit && item.latestTask && (
          <ProjectSyncStatus projectId={id} task={item.latestTask} />
        )}
        {item.canEdit && (
          <details className="danger-details">
            <summary>删除这个项目</summary>
            <ActionForm action={deleteProjectAction}>
              <input type="hidden" name="id" value={id} />
              {item.authorId !== user!.id && (
                <label>
                  删除原因
                  <input name="reason" required minLength={2} maxLength={500} />
                </label>
              )}
              <p className="muted">
                删除后项目、代码、下载和讨论都将隐藏，操作记录与已保存版本会保留。
              </p>
              <div>
                <Button size="sm" variant="destructive">
                  确认删除项目
                </Button>
              </div>
            </ActionForm>
          </details>
        )}
      </article>
      {item.member ? (
        <>
          <ProjectBrowser
            key={item.currentVersionId || id}
            projectId={id}
            versions={item.versions}
            currentVersionId={item.currentVersionId}
          />
          {item.versions.length > 0 && (
            <ProjectDiscussion projectId={id} userId={user!.id} admin={admin} />
          )}
        </>
      ) : (
        <section className="panel locked-box">
          <LockKeyhole size={24} />
          <h3>代码与讨论，向社区成员开放</h3>
          <p className="muted">登录并通过审批后，可以阅读项目代码、下载历史版本和参与讨论。</p>
          <Button asChild variant="outline">
            <Link href={user ? "/account" : "/register"}>
              {user ? "查看申请状态" : "申请加入社区"}
            </Link>
          </Button>
        </section>
      )}
    </div>
  );
}
