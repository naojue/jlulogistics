"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { retryProjectAction } from "@/app/project-actions";
import { projectStatusLabel } from "@/components/project-labels";

export type ProjectTask = { status: string; error: string | null };

export function ProjectSyncStatus({ projectId, task }: { projectId: string; task: ProjectTask }) {
  const [current, setCurrent] = useState(task);
  const [networkError, setNetworkError] = useState("");
  const router = useRouter();
  useEffect(() => setCurrent(task), [task]);
  useEffect(() => {
    if (!["QUEUED", "RUNNING"].includes(current.status)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/projects/${projectId}/status`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const next = await response.json();
        if (!response.ok) throw new Error(next.error || "同步状态读取失败");
        setCurrent(next);
        setNetworkError("");
        if (!["QUEUED", "RUNNING"].includes(next.status)) router.refresh();
        else timer = setTimeout(poll, 3000);
      } catch (error) {
        if (controller.signal.aborted) return;
        setNetworkError(error instanceof Error ? error.message : "同步状态读取失败");
        timer = setTimeout(poll, 6000);
      }
    }
    timer = setTimeout(poll, 1500);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [projectId, current.status, router]);
  return (
    <div className={`project-sync project-sync-${current.status.toLowerCase()}`} role="status">
      <strong>{projectStatusLabel[current.status] || current.status}</strong>
      {["QUEUED", "RUNNING"].includes(current.status) && (
        <p className="muted">
          正在保存项目文件，完成后会自动更新。你可以离开本页，稍后从“我的项目”查看。
        </p>
      )}
      {current.error && <p className="form-error">{current.error}</p>}
      {networkError && <p className="muted">{networkError}，正在尝试重新连接。</p>}
      {current.status === "FAILED" && (
        <ActionForm action={retryProjectAction}>
          <input type="hidden" name="id" value={projectId} />
          <div>
            <Button size="sm" variant="outline">
              重新同步
            </Button>
          </div>
        </ActionForm>
      )}
    </div>
  );
}
