"use client";
import { useCallback, useEffect, useState } from "react";
import { ImageInput } from "@/components/image-input";
import { ImageGallery } from "@/components/image-gallery";
import { Button } from "@/components/ui/button";
import { MAX_FILE_SIZE, MAX_IMAGE_COUNT } from "@/lib/files";
import { date } from "@/lib/utils";

type Item = {
  id: string;
  body: string;
  parentId: string | null;
  authorId: string;
  author: { name: string };
  createdAt: string;
  pdfPage: number;
  resolvedAt: string | null;
  attachments: { id: string; file: { name: string } }[];
};
type QuestionData = { items: Item[]; pages: number; userId: string; admin: boolean };

function QuestionForm({
  endpoint,
  children,
  onSaved,
  reset = false,
}: {
  endpoint: string;
  children: React.ReactNode;
  onSaved: () => void;
  reset?: boolean;
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
        const form = event.currentTarget;
        const body = new FormData(form);
        const files = body
          .getAll("file")
          .filter((file): file is File => file instanceof File && !!file.name);
        if (
          files.length > MAX_IMAGE_COUNT ||
          files.some((file) => !file.size || !/\.(jpe?g|png|webp)$/i.test(file.name)) ||
          files.reduce((sum, file) => sum + file.size, 0) > MAX_FILE_SIZE
        ) {
          setError("请选择有效图片，最多 20 张且总量不超过 50MB");
          return;
        }
        setPending(true);
        setError("");
        setProgress(0);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", endpoint);
        xhr.timeout = 120_000;
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
        };
        xhr.onload = () => {
          setPending(false);
          try {
            const result = JSON.parse(xhr.responseText);
            if (xhr.status < 200 || xhr.status >= 300) {
              setError(result.error || "操作失败，请重试");
              return;
            }
            if (reset) {
              form.reset();
              setRevision((value) => value + 1);
            }
            onSaved();
          } catch {
            setError("操作失败，请稍后重试");
          }
        };
        xhr.onerror = xhr.ontimeout = () => {
          setPending(false);
          setError("连接中断或超时，已保留输入，请重试");
        };
        xhr.send(body);
      }}
    >
      <fieldset disabled={pending} key={revision}>
        {children}
      </fieldset>
      {pending && (
        <p className="muted" role="status">
          上传进度 {progress}%{progress === 100 ? "，正在保存" : ""}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function PdfQuestions({
  resourceId,
  fileId,
  page,
  onJump,
}: {
  resourceId: string;
  fileId: string;
  page: number;
  onJump: (page: number) => void;
}) {
  const endpoint = `/api/resources/${resourceId}/questions`;
  const [data, setData] = useState<QuestionData | null>(null);
  const [scope, setScope] = useState<"page" | "all">("page");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`${endpoint}?fileId=${encodeURIComponent(fileId)}`, {
          cache: "no-store",
          signal,
        });
        const result = await response.json();
        if (!response.ok) {
          if (response.status === 401 || response.status === 403 || response.status === 404)
            setData(null);
          throw new Error(result.error || "问题读取失败");
        }
        setData(result);
      } catch (error) {
        if (!signal?.aborted)
          setError(error instanceof Error ? error.message : "问题读取失败，请重试");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [endpoint, fileId],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const refresh = () => {
    void load();
  };
  const roots = data?.items.filter((item) => !item.parentId) || [];
  const visibleCount = roots.filter((item) => scope === "all" || item.pdfPage === page).length;
  function hidden(action: string, questionId?: string) {
    return (
      <>
        <input type="hidden" name="action" value={action} />
        <input type="hidden" name="fileId" value={fileId} />
        {questionId && <input type="hidden" name="questionId" value={questionId} />}
      </>
    );
  }
  function deletion(item: Item) {
    if (!data || (!data.admin && item.authorId !== data.userId)) return null;
    return (
      <details>
        <summary>管理这条{item.parentId ? "回复" : "问题"}</summary>
        <QuestionForm endpoint={endpoint} onSaved={refresh}>
          {hidden("delete", item.id)}
          {item.authorId !== data.userId && (
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
            删除{item.parentId ? "回复" : "问题"}
          </Button>
        </QuestionForm>
      </details>
    );
  }
  function view(item: Item, nested = false) {
    return (
      <div className="discussion-item" key={item.id}>
        <div className="discussion-header">
          <strong>{item.author.name}</strong>
          <small>{date(new Date(item.createdAt))}</small>
          {!nested && <span className="badge">{item.resolvedAt ? "已解决" : "待解决"}</span>}
        </div>
        {!nested && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onJump(item.pdfPage)}>
            跳到第 {item.pdfPage} 页
          </Button>
        )}
        <p className="discussion-body">{item.body}</p>
        <ImageGallery images={item.attachments} />
        {!nested && data && (data.admin || item.authorId === data.userId) && (
          <QuestionForm endpoint={endpoint} onSaved={refresh}>
            {hidden(item.resolvedAt ? "reopen" : "resolve", item.id)}
            <Button size="sm" variant="outline">
              {item.resolvedAt ? "重新打开" : "标记已解决"}
            </Button>
          </QuestionForm>
        )}
        {deletion(item)}
        {!nested && (
          <>
            <details>
              <summary>回复这个问题</summary>
              <QuestionForm endpoint={endpoint} onSaved={refresh} reset>
                {hidden("reply", item.id)}
                <label>
                  回复内容
                  <textarea name="body" required maxLength={3000} rows={2} />
                </label>
                <ImageInput />
                <Button size="sm">提交回复</Button>
              </QuestionForm>
            </details>
            <div className="discussion-children">
              {data?.items
                .filter((child) => child.parentId === item.id)
                .map((child) => view(child, true))}
            </div>
          </>
        )}
      </div>
    );
  }
  return (
    <section className="panel" aria-label="PDF 按页提问">
      <h2>按页提问</h2>
      <p className="muted">问题绑定这份 PDF 的具体页码，普通资料留言仍在下方讨论区。</p>
      {error && (
        <p className="form-error" role="alert">
          {error}{" "}
          <Button type="button" size="sm" variant="outline" onClick={refresh}>
            重试
          </Button>
        </p>
      )}
      {loading && <p role="status">正在读取问题…</p>}
      {data && (
        <>
          <div className="tabs">
            <Button
              type="button"
              size="sm"
              variant={scope === "page" ? "default" : "outline"}
              aria-pressed={scope === "page"}
              onClick={() => setScope("page")}
            >
              当前页问题
            </Button>
            <Button
              type="button"
              size="sm"
              variant={scope === "all" ? "default" : "outline"}
              aria-pressed={scope === "all"}
              onClick={() => setScope("all")}
            >
              全部问题
            </Button>
          </div>
          <p className="muted">
            {scope === "page" ? `第 ${page} 页` : "全部页码"} · {visibleCount} 个问题
          </p>
          <QuestionForm endpoint={endpoint} onSaved={refresh} reset>
            {hidden("ask")}
            <input type="hidden" name="page" value={page} />
            <label>
              向第 {page} 页提问
              <textarea
                name="body"
                required
                maxLength={3000}
                rows={3}
                placeholder="说明你不理解的公式、步骤或结论…"
              />
            </label>
            <ImageInput />
            <Button size="sm">发布第 {page} 页问题</Button>
          </QuestionForm>
          {!visibleCount && <p className="inline-note">这里还没有问题，来提出第一个问题吧。</p>}
          {/* Keep forms mounted while changing pages/tabs, preserving text and selected files. */}
          {roots.map((item) => (
            <div key={item.id} hidden={scope === "page" && item.pdfPage !== page}>
              {view(item)}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
