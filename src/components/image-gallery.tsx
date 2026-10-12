"use client";
import { useState } from "react";
export function ImageGallery({ images }: { images: { id: string; file: { name: string } }[] }) {
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
          {/* Private media must bypass the public Next image optimization cache. */}
          <img src={`/api/attachments/${image.id}`} alt={image.file.name} loading="lazy" />
        </button>
      ))}
      {selected && (
        <div
          className="image-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
          onClick={() => setSelected(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setSelected(null);
          }}
        >
          <button type="button" autoFocus onClick={() => setSelected(null)}>
            关闭预览
          </button>
          <img
            src={`/api/attachments/${selected}`}
            alt={images.find((image) => image.id === selected)?.file.name || "图片"}
          />
        </div>
      )}
    </div>
  );
}
