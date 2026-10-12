"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { retryProjectAction } from "@/app/project-actions";
import { fileSize } from "@/lib/utils";
import type { ProjectTask } from "@/components/project-sync-status";
import { projectStatusLabel } from "@/components/project-labels";

const MAX_PROJECT_SIZE = 200 * 1024 * 1024;
type Draft = { id: string; title: string; description: string; course: string; tags: string };

export function ProjectUploadForm({
  project,
  configured,
}: {
  project?: Draft;
  configured: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [selectedSize, setSelectedSize] = useState<number | null>(null);
  const [projectId, setProjectId] = useState(project?.id || "");
  const [task, setTask] = useState<ProjectTask | null>(null);
  const [checking, setChecking] = useState(false);
  const uploadRef = useRef<XMLHttpRequest | null>(null);
  const requestId = useRef("");
  const router = useRouter();
  const processing = !!task && ["QUEUED", "RUNNING"].includes(task.status);
  useEffect(() => () => uploadRef.current?.abort(), []);
  useEffect(() => {
    if (!processing || !projectId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/projects/${projectId}/status`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "读取状态失败");
        setTask(result);
        setError("");
        if (result.status === "SUCCEEDED") {
          router.push(`/projects/${projectId}`);
          router.refresh();
        } else if (["QUEUED", "RUNNING"].includes(result.status)) {
          timer = setTimeout(poll, 3000);
        } else {
          // A confirmed failed job can be retried or replaced. Network failures retain the ID.
          requestId.current = "";
        }
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "暂时无法读取同步状态");
        timer = setTimeout(poll, 6000);
      }
    }
    timer = setTimeout(poll, 1500);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [processing, projectId, router]);

  async function retry() {
    setChecking(true);
    setError("");
    const form = new FormData();
    form.set("id", projectId);
    try {
      const result = await retryProjectAction(form);
      if (result.error) setError(result.error);
      else setTask({ status: "QUEUED", error: null });
    } catch {
      setError("连接失败，请稍后重试");
    } finally {
      setChecking(false);
    }
  }

  return (
    <form
      className="form-stack project-upload-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || processing || !configured) return;
        const form = new FormData(event.currentTarget);
        if (!requestId.current) requestId.current = crypto.randomUUID();
        form.set("requestId", requestId.current);
        const file = form.get("file");
        if (!(file instanceof File) || !file.size || !/\.zip$/i.test(file.name)) {
          setError("请选择有效的项目 ZIP 文件");
          return;
        }
        if (file.size > MAX_PROJECT_SIZE) {
          setError("项目 ZIP 不能超过 200MB");
          return;
        }
        if (projectId) form.set("projectId", projectId);
        setPending(true);
        setProgress(0);
        setError("");
        setTask(null);
        const xhr = new XMLHttpRequest();
        uploadRef.current = xhr;
        xhr.open("POST", "/api/projects");
        xhr.upload.onprogress = (status) => {
          if (status.lengthComputable)
            setProgress(Math.round((status.loaded / status.total) * 100));
        };
        xhr.onload = () => {
          setPending(false);
          try {
            const result = JSON.parse(xhr.responseText);
            if (xhr.status < 200 || xhr.status >= 300) {
              setError(result.error || "上传失败，请稍后重试");
              return;
            }
            setProjectId(result.id);
            setTask({ status: result.status || "QUEUED", error: null });
            if (result.status === "SUCCEEDED") {
              router.push(`/projects/${result.id}`);
              router.refresh();
            }
          } catch {
            setError("上传失败，请稍后重试");
          }
        };
        xhr.onerror = () => {
          setPending(false);
          setError("连接中断，输入和选中的文件已保留，请重新上传");
        };
        xhr.onabort = () => {
          setPending(false);
        };
        xhr.send(form);
      }}
    >
      {!configured && (
        <p role="status" className="inline-note">
          管理员尚未完成项目存储配置，暂时不能上传。你可以先准备项目 ZIP。
        </p>
      )}
      <fieldset disabled={pending || processing || checking || !configured}>
        {!project && (
          <>
            <label>
              项目名称
              <input
                name="title"
                required
                minLength={3}
                maxLength={120}
                placeholder="例如：配送路线规划与算法比较"
              />
            </label>
            <label>
              项目介绍
              <textarea
                name="description"
                required
                minLength={10}
                maxLength={5000}
                rows={5}
                placeholder="介绍要解决的问题、主要功能和项目成果。运行步骤请放在项目 README 中。"
              />
            </label>
            <label>
              课程 / 主题
              <input
                name="course"
                required
                minLength={2}
                maxLength={100}
                placeholder="例如：运筹学、数据结构、数据库课程设计"
              />
            </label>
            <label>
              技术标签
              <input
                name="tags"
                maxLength={300}
                placeholder="用逗号分隔，例如 Python,最短路径,数据分析"
              />
            </label>
          </>
        )}
        {project && (
          <>
            <input type="hidden" name="title" value={project.title} />
            <input type="hidden" name="description" value={project.description} />
            <input type="hidden" name="course" value={project.course} />
            <input type="hidden" name="tags" value={project.tags} />
          </>
        )}
        <label>
          项目 ZIP
          <input
            type="file"
            name="file"
            accept=".zip"
            required
            onChange={(event) => {
              setSelectedSize(event.currentTarget.files?.[0]?.size ?? null);
              requestId.current = "";
              setTask(null);
            }}
          />
          <small className="muted">
            压缩包及解压后的文件分别不超过 200MB · 单个文件不超过 100MiB · 最多 1000 个文件
          </small>
          {selectedSize !== null && <small>已选择 {fileSize(selectedSize)}</small>}
        </label>
        <p className="inline-note">
          请上传源代码、README
          和小样例数据。依赖目录、编译产物、密码密钥及自动执行的工作流不会导入；项目代码不会在线运行。
        </p>
        <label>
          {project ? "版本更新说明" : "首版说明"}
          <textarea
            name="versionMessage"
            required
            minLength={2}
            maxLength={2000}
            rows={3}
            placeholder={
              project ? "这次调整了哪些功能或修复了什么问题？" : "描述这一版已完成的功能。"
            }
          />
        </label>
        <div>
          <Button>
            {task?.status === "FAILED"
              ? "重新上传项目包"
              : project
                ? "上传新版本"
                : "上传并发布项目"}
          </Button>
        </div>
      </fieldset>
      {pending && (
        <p role="status" className="muted">
          上传进度 {progress}%{progress === 100 ? "，正在检查项目包" : ""}
        </p>
      )}
      {task && (
        <div role="status" className={`project-sync project-sync-${task.status.toLowerCase()}`}>
          <strong>{projectStatusLabel[task.status] || task.status}</strong>
          {processing && (
            <p className="muted">
              文件已接收，正在同步保存。你可以保留本页等待，也可以稍后从“我的项目”查看。
            </p>
          )}
          {task.error && <p className="form-error">{task.error}</p>}
          {task.status === "FAILED" && (
            <Button type="button" variant="outline" size="sm" disabled={checking} onClick={retry}>
              重新同步已上传的文件
            </Button>
          )}
          {projectId && (
            <p>
              <Link className="text-link" href={`/projects/${projectId}`}>
                查看项目与同步状态 →
              </Link>
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
