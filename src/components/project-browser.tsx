"use client";
import { useEffect, useState } from "react";
import { Code2, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fileSize } from "@/lib/utils";

type Version = {
  id: string;
  number: number;
  message: string;
  fileCount: number;
  size: number;
  createdAt: Date | string;
};
type Entry = { path: string; size: number };

export function ProjectBrowser({
  projectId,
  versions,
  currentVersionId,
}: {
  projectId: string;
  versions: Version[];
  currentVersionId: string | null;
}) {
  const [versionId, setVersionId] = useState(currentVersionId || versions[0]?.id || "");
  const [files, setFiles] = useState<Entry[]>([]);
  const [selected, setSelected] = useState("");
  const [content, setContent] = useState<{ text: string; truncated?: boolean } | null>(null);
  const [listError, setListError] = useState("");
  const [fileError, setFileError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingFile, setLoadingFile] = useState(false);
  const [filter, setFilter] = useState("");
  useEffect(() => {
    if (!versionId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setListError("");
    setFiles([]);
    setSelected("");
    setContent(null);
    fetch(`/api/projects/${projectId}/files?${new URLSearchParams({ versionId })}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "文件目录读取失败");
        return result;
      })
      .then((result: { files: Entry[] }) => {
        setFiles(result.files);
        setSelected(
          result.files.find((file) => /(^|\/)readme(?:\.[^/]*)?$/i.test(file.path))?.path ||
            result.files[0]?.path ||
            "",
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setListError(error instanceof Error ? error.message : "文件目录读取失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId, versionId]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setLoadingFile(true);
    setFileError("");
    setContent(null);
    fetch(`/api/projects/${projectId}/file?${new URLSearchParams({ versionId, path: selected })}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "文件内容读取失败");
        return result;
      })
      .then(setContent)
      .catch((error) => {
        if (!controller.signal.aborted)
          setFileError(error instanceof Error ? error.message : "文件内容读取失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingFile(false);
      });
    return () => controller.abort();
  }, [projectId, selected, versionId]);
  const version = versions.find((item) => item.id === versionId);
  if (!versions.length)
    return <p className="inline-note">项目文件尚未同步完成，完成后可在这里浏览代码和下载。</p>;
  return (
    <section className="panel project-browser">
      <div className="project-section-heading">
        <h2>
          <Code2 size={21} /> 项目文件
        </h2>
        <Button asChild variant="outline" size="sm">
          <a href={`/api/projects/${projectId}/download?${new URLSearchParams({ versionId })}`}>
            <Download size={15} /> 下载此版本
          </a>
        </Button>
      </div>
      <label className="project-version-picker">
        选择版本
        <select
          aria-label="项目版本"
          value={versionId}
          onChange={(event) => {
            setVersionId(event.currentTarget.value);
            setFilter("");
          }}
        >
          {versions.map((item) => (
            <option key={item.id} value={item.id}>
              v{item.number} · {new Date(item.createdAt).toLocaleDateString("zh-CN")}
              {item.id === currentVersionId ? " · 当前版本" : ""}
            </option>
          ))}
        </select>
      </label>
      {version && (
        <div className="project-version-note">
          <p className="prose-text">{version.message}</p>
          <small className="muted">
            {version.fileCount} 个文件 · {fileSize(version.size)}
          </small>
        </div>
      )}
      {loading && (
        <p role="status" className="muted">
          正在读取文件目录…
        </p>
      )}
      {listError && (
        <p role="alert" className="form-error">
          {listError}
        </p>
      )}
      {!loading && !listError && (
        <div className="project-code-layout">
          <aside className="project-file-tree" aria-label="项目文件目录">
            <input
              aria-label="筛选项目文件"
              placeholder="筛选文件名…"
              value={filter}
              onChange={(event) => setFilter(event.currentTarget.value)}
            />
            <div className="project-file-list">
              {files
                .filter((file) => file.path.toLowerCase().includes(filter.toLowerCase()))
                .map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    title={file.path}
                    aria-pressed={selected === file.path}
                    className={selected === file.path ? "project-file-active" : ""}
                    onClick={() => setSelected(file.path)}
                  >
                    <FileText size={14} />
                    <span>{file.path}</span>
                  </button>
                ))}
              {!files.length && <p className="muted">此版本没有可浏览的文件。</p>}
              {!!files.length &&
                !files.some((file) => file.path.toLowerCase().includes(filter.toLowerCase())) && (
                  <p className="muted">没有匹配的文件。</p>
                )}
            </div>
          </aside>
          <div className="project-code-content">
            <div className="project-code-heading">{selected || "选择文件"}</div>
            {loadingFile && (
              <p role="status" className="muted">
                正在读取内容…
              </p>
            )}
            {fileError && (
              <p role="alert" className="inline-note">
                {fileError}。可以下载此版本在本地查看。
              </p>
            )}
            {content && (
              <>
                <pre className="project-code" tabIndex={0} aria-label={`文件内容：${selected}`}>
                  <code>{content.text}</code>
                </pre>
                {content.truncated && (
                  <p className="inline-note">文件较大，仅展示开头内容；下载后可查看完整文件。</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
      <p className="muted project-code-footnote">
        README 和代码以纯文本展示。运行步骤请参考 README，项目代码在本地运行。
      </p>
    </section>
  );
}
