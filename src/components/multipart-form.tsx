"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_FILE_SIZE, MAX_IMAGE_COUNT } from "@/lib/files";
export function MultipartForm({
  endpoint,
  children,
  redirectBase,
  reset = false,
  imagesOnly = false,
}: {
  endpoint: string;
  children: React.ReactNode;
  redirectBase?: string;
  reset?: boolean;
  imagesOnly?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [revision, setRevision] = useState(0);
  const router = useRouter();
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
        if (files.length > MAX_IMAGE_COUNT) {
          setError("最多上传 20 张图片");
          return;
        }
        if (
          files.some((file) => !file.size) ||
          files.reduce((total, file) => total + file.size, 0) > MAX_FILE_SIZE
        ) {
          setError("文件不能为空，总量不能超过 50MB");
          return;
        }
        if (imagesOnly && files.some((file) => !/\.(jpe?g|png|webp)$/i.test(file.name))) {
          setError("请选择 JPG、PNG 或 WebP 图片");
          return;
        }
        const removeIds = form.getAll("removeIds").map(String);
        form.delete("removeIds");
        form.set("removeIds", JSON.stringify(removeIds));
        setPending(true);
        setError("");
        setProgress(0);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", endpoint);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
        };
        xhr.onload = () => {
          setPending(false);
          try {
            const result = JSON.parse(xhr.responseText);
            if (xhr.status < 200 || xhr.status >= 300) {
              setError(result.error || "发布失败");
              return;
            }
            if (reset) {
              element.reset();
              setRevision((value) => value + 1);
            }
            if (redirectBase) router.push(redirectBase + result.id);
            router.refresh();
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
        {children}
      </fieldset>
      {pending && (
        <p role="status" className="muted">
          上传进度 {progress}%{progress === 100 ? "，正在保存" : ""}
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
