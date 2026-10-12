"use client";
import { useState } from "react";
import { fileSize } from "@/lib/utils";
export function ImageInput() {
  const [files, setFiles] = useState<File[]>([]);
  return (
    <label>
      附加图片（可选）
      <input
        type="file"
        name="file"
        multiple
        accept=".jpg,.jpeg,.png,.webp"
        onChange={(event) => setFiles(Array.from(event.currentTarget.files || []))}
      />
      <small className="muted">JPG、PNG、WebP · 最多 20 张 · 每次发布总计不超过 50MB</small>
      {files.length > 0 && (
        <small>
          {files.length} 张 · 合计 {fileSize(files.reduce((total, file) => total + file.size, 0))}
        </small>
      )}
    </label>
  );
}
