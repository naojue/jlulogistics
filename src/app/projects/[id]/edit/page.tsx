import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { memberPage } from "@/lib/session";
import { AppError } from "@/lib/policy";
import { projectDetail } from "@/services/projects";
import { updateProjectAction } from "@/app/project-actions";
import { ActionForm } from "@/components/action-form";
import { PageHeading } from "@/components/common";
import { ProjectUploadForm } from "@/components/project-upload-form";
import { ProjectSyncStatus } from "@/components/project-sync-status";
import { Button } from "@/components/ui/button";

export default async function EditProject({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await memberPage();
  const item = await projectDetail(user, id).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  });
  if (!item || !item.canEdit) notFound();
  return (
    <div className="narrow">
      <Link className="back-link" href={`/projects/${id}`}>
        <ArrowLeft size={15} />
        返回项目
      </Link>
      <PageHeading
        eyebrow="KEEP YOUR PROJECT GROWING"
        title="编辑与更新项目"
        description="介绍信息可以单独修改；上传新 ZIP 会生成一个新版本，已发布版本继续保留。"
      />
      <section className="panel">
        <h2>项目介绍</h2>
        <ActionForm action={updateProjectAction}>
          <input type="hidden" name="id" value={id} />
          <label>
            项目名称
            <input name="title" defaultValue={item.title} required minLength={3} maxLength={120} />
          </label>
          <label>
            项目介绍
            <textarea
              name="description"
              defaultValue={item.description}
              required
              minLength={10}
              maxLength={5000}
              rows={5}
            />
          </label>
          <label>
            课程 / 主题
            <input
              name="course"
              defaultValue={item.course}
              required
              minLength={2}
              maxLength={100}
            />
          </label>
          <label>
            技术标签
            <input name="tags" defaultValue={item.tags} maxLength={300} />
            <small className="muted">多个标签用逗号分隔。</small>
          </label>
          <div>
            <Button variant="outline">保存介绍</Button>
          </div>
        </ActionForm>
      </section>
      <section className="panel">
        <h2>上传新版本</h2>
        {item.latestTask && <ProjectSyncStatus projectId={id} task={item.latestTask} />}
        {!item.latestTask || !["QUEUED", "RUNNING"].includes(item.latestTask.status) ? (
          <ProjectUploadForm project={item} configured={item.configured} />
        ) : null}
      </section>
    </div>
  );
}
