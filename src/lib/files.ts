export const MAX_FILE_SIZE = 50 * 1024 * 1024;
export const MAX_IMAGE_COUNT = 20;
export type UploadFile = { key: string; name: string; mime: string; size: number };
export const isImage = (mime: string) => ["image/jpeg", "image/png", "image/webp"].includes(mime);
export function fileExtension(name: string) {
  return name.split(".").at(-1)?.toLowerCase() || "";
}
