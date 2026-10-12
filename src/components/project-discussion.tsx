"use client";
import { useCallback, useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ImageInput } from "@/components/image-input";
import { Button } from "@/components/ui/button";
import { deleteProjectCommentAction } from "@/app/project-actions";
import { MAX_FILE_SIZE, MAX_IMAGE_COUNT } from "@/lib/files";

type Comment = {
  id: string;
  body: string;
  parentId: string | null;
  authorId: string;
  author: { name: string };
  createdAt: string;
  attachments: { id: string; file: { name: string } }[];
};

function ProjectImages({ images }: { images: Comment["attachments"] }) {
  const [selected, setSelected] = useState<string | null>(null);
  if (!images.length) return null;
  return (
    <div className="image-gallery">
      {images.map((image) => (
        <button
          type="button"
          className="image-thumbnail"
          key={image.id}
          onClick={() => setSelected(image.id)}
          aria-label={`放大图片：${image.file.name}`}
        >
          <img src={`/api/project-images/${image.id}`} alt={image.file.name} loading="lazy" />
        </button>
      ))}
      {selected && (
        <div
          className="image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="项目图片预览"
          onClick={() => setSelected(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setSelected(null);
          }}
        >
          <button type="button" autoFocus onClick={() => setSelected(null)}>
            关闭预览
          </button>
          <img
            src={`/api/project-images/${selected}`}
            alt={images.find((image) => image.id === selected)?.file.name || "图片"}
          />
        </div>
      )}
    </div>
  );
}

function CommentForm({
  projectId,
  parentId,
  onDone,
}: {
  projectId: string;
  parentId?: string;
  onDone: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [revision, setRevision] = useState(0);
  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const element = event.currentTarget;
        const form = new FormData(element);
        const files = form
          .getAll("file")
          .filter((item): item is File => item instanceof File && !!item.name);
        if (
          files.length > MAX_IMAGE_COUNT ||
          files.some((file) => !file.size || !/\.(jpe?g|png|webp)$/i.test(file.name)) ||
          files.reduce((sum, file) => sum + file.size, 0) > MAX_FILE_SIZE
        ) {
          setError("请选择 JPG、PNG 或 WebP 图片，最多 20 张，总量不超过 50MB");
          return;
        }
        setPending(true);
        setError("");
        setProgress(0);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/projects/${projectId}/discussions`);
        xhr.upload.onprogress = (status) => {
          if (status.lengthComputable)
            setProgress(Math.round((status.loaded / status.total) * 100));
        };
        xhr.onload = () => {
          setPending(false);
          try {
            const result = JSON.parse(xhr.responseText);
            if (xhr.status < 200 || xhr.status >= 300) {
              setError(result.error || "发布失败");
              return;
            }
            element.reset();
            setRevision((value) => value + 1);
            onDone();
          } catch {
            setError("发布失败，请稍后重试");
          }
        };
        xhr.onerror = () => {
          setPending(false);
          setError("连接中断，请重试");
        };
        xhr.send(form);
      }}
    >
      <fieldset disabled={pending} key={revision}>
        <input type="hidden" name="parentId" value={parentId || ""} />
        <label>
          {parentId ? "回复内容" : "分享你的想法"}
          <textarea
            name="body"
            required
            maxLength={3000}
            rows={parentId ? 2 : 3}
            placeholder="讨论实现思路、实验结果或遇到的问题。"
          />
        </label>
        <ImageInput />
        <div>
          <Button size="sm">
            {parentId ? "提交回复" : "发布留言"}
            <MessageCircle size={14} />
          </Button>
        </div>
      </fieldset>
      {pending && (
        <p role="status" className="muted">
          上传进度 {progress}%{progress === 100 ? "，正在发布" : ""}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </form>
  );
}

export function ProjectDiscussion({
  projectId,
  userId,
  admin,
}: {
  projectId: string;
  userId: string;
  admin: boolean;
}) {
  const [items, setItems] = useState<Comment[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/projects/${projectId}/discussions`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "讨论读取失败");
        return result;
      })
      .then((result: Comment[] | { items: Comment[] }) => {
        setItems(Array.isArray(result) ? result : result.items);
        setError("");
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setError(caught instanceof Error ? caught.message : "讨论读取失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, revision]);
  function view(item: Comment, nested = false) {
    return (
      <div className="discussion-item" key={item.id}>
        <div className="discussion-header">
          <span className="avatar avatar-small">{item.author.name.slice(0, 1)}</span>
          <strong>{item.author.name}</strong>
          <small>{new Date(item.createdAt).toLocaleDateString("zh-CN")}</small>
        </div>
        <p className="discussion-body">{item.body}</p>
        <ProjectImages images={item.attachments} />
        {(admin || item.authorId === userId) && (
          <details>
            <summary>管理这条留言</summary>
            <ActionForm
              action={async (form) => {
                const result = await deleteProjectCommentAction(form);
                if (!result.error) reload();
                return result;
              }}
              className="mini-form"
            >
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="projectId" value={projectId} />
              {item.authorId !== userId && (
                <input
                  name="reason"
                  required
                  minLength={2}
                  maxLength={500}
                  placeholder="删除原因"
                  aria-label="删除原因"
                />
              )}
              <Button variant="destructive" size="sm">
                删除留言
              </Button>
            </ActionForm>
          </details>
        )}
        {!nested && (
          <>
            <details>
              <summary>回复</summary>
              <CommentForm projectId={projectId} parentId={item.id} onDone={reload} />
            </details>
            <div className="discussion-children">
              {items
                .filter((child) => child.parentId === item.id)
                .map((child) => view(child, true))}
            </div>
          </>
        )}
      </div>
    );
  }
  return (
    <section className="panel">
      <h2>
        项目讨论 <span className="muted">{items.length} 条留言</span>
      </h2>
      <CommentForm projectId={projectId} onDone={reload} />
      {loading && (
        <p role="status" className="muted">
          正在读取讨论…
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
          <button type="button" className="text-link" onClick={reload}>
            重新读取
          </button>
        </p>
      )}
      {items.filter((item) => !item.parentId).map((item) => view(item))}
      {!loading && !error && !items.length && (
        <p className="inline-note">还没有留言，来分享第一个想法吧。</p>
      )}
    </section>
  );
}
