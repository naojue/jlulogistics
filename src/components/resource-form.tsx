"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionForm } from "@/components/action-form";
import { resourceEditAction } from "@/app/actions";
import { MAX_FILE_SIZE, MAX_IMAGE_COUNT } from "@/lib/files";
import { fileSize } from "@/lib/utils";
type Props = {
  admin: boolean;
  categories: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  resource?: {
    id: string;
    title: string;
    description: string;
    area: string;
    categoryId: string;
    tags: { id: string }[];
  };
};
export function ResourceForm({ admin, categories, tags, resource }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const router = useRouter();
  const fields = (
    <>
      <input type="hidden" name="id" value={resource?.id || ""} />
      <label>
        资料标题
        <input
          name="title"
          defaultValue={resource?.title}
          required
          minLength={2}
          maxLength={120}
          placeholder="清晰的标题，让好资料更容易被找到"
        />
      </label>
      <label>
        资料简介
        <textarea
          name="description"
          defaultValue={resource?.description}
          required
          minLength={10}
          maxLength={3000}
          rows={5}
          placeholder="介绍内容、适用人群和学习建议（至少 10 个字）"
        />
      </label>
      <div className="form-row">
        <label>
          资料分类
          <select name="categoryId" defaultValue={resource?.categoryId || ""} required>
            <option value="" disabled>
              选择分类
            </option>
            {categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          发布位置
          <select name="area" defaultValue={resource?.area || "MEMBER"}>
            <option value="MEMBER">成员分享区</option>
            {admin && <option value="ADMIN">管理员资料区</option>}
          </select>
        </label>
      </div>
      <div>
        <p className="muted" style={{ marginBottom: 10 }}>
          资料标签（最多 10 个）
        </p>
        <div className="checkboxes">
          {tags.map((tag) => (
            <label className="checkbox-label" key={tag.id}>
              <input
                type="checkbox"
                name="tagIds"
                value={tag.id}
                defaultChecked={resource?.tags.some((item) => item.id === tag.id)}
              />
              {tag.name}
            </label>
          ))}
        </div>
      </div>
      {!resource && (
        <label className="upload-zone">
          <UploadCloud size={30} />
          <strong>选择一份文档，或一组学习图片</strong>
          <input
            name="file"
            type="file"
            multiple
            onChange={(event) => setSelectedFiles(Array.from(event.currentTarget.files || []))}
            required
            accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.jpg,.jpeg,.png,.webp,.zip"
          />
          <small>一份文档 / ZIP，或最多 20 张图片 · 总量不超过 50MB</small>
          {!!selectedFiles.length && (
            <small>
              已选择 {selectedFiles.length} 个文件 · 合计{" "}
              {fileSize(selectedFiles.reduce((total, file) => total + file.size, 0))}
            </small>
          )}
        </label>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "正在上传…" : resource ? "保存资料信息" : "发布资料"}
        <ArrowRight size={16} />
      </Button>
    </>
  );
  if (resource)
    return (
      <ActionForm action={resourceEditAction} redirectBase="/resources/">
        {fields}
      </ActionForm>
    );
  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const form = new FormData(event.currentTarget);
        const files = form.getAll("file").filter((file): file is File => file instanceof File);
        if (!files.length || files.some((file) => !file.size)) {
          setError("请选择非空文件");
          return;
        }
        if (files.reduce((total, file) => total + file.size, 0) > MAX_FILE_SIZE) {
          setError("文件总量不能超过 50MB");
          return;
        }
        if (
          files.length > MAX_IMAGE_COUNT ||
          (files.length > 1 && files.some((file) => !/\.(jpe?g|png|webp)$/i.test(file.name)))
        ) {
          setError("可上传一份文档 / ZIP，或最多 20 张图片");
          return;
        }
        const tagIds = form.getAll("tagIds").map(String);
        form.delete("tagIds");
        form.append("tagIds", JSON.stringify(tagIds));
        setPending(true);
        setError("");
        setProgress(0);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/resources");
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
        };
        xhr.onload = () => {
          setPending(false);
          try {
            const result = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) {
              router.push(`/resources/${result.id}`);
              router.refresh();
            } else setError(result.error || "上传失败");
          } catch {
            setError("上传失败，请稍后重试");
          }
        };
        xhr.onerror = () => {
          setPending(false);
          setError("连接中断，请重试");
        };
        xhr.send(form);
      }}
    >
      <fieldset disabled={pending}>{fields}</fieldset>
      {pending && (
        <>
          <progress className="upload-progress" value={progress} max={100} />
          <p className="muted" role="status">
            上传进度 {progress}%{progress === 100 ? "，正在保存资料" : ""}
          </p>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="inline-note">
        发布后立即显示。请分享你有权传播的资料，并避免在公开简介中填写个人隐私。
      </p>
    </form>
  );
}
