import { MultipartForm } from "@/components/multipart-form";
import { ImageInput } from "@/components/image-input";
import { ImageGallery } from "@/components/image-gallery";
import { Button } from "@/components/ui/button";
export function PostForm({
  categories,
  post,
}: {
  categories: { id: string; name: string }[];
  post?: {
    id: string;
    title: string;
    body: string;
    categoryId: string;
    attachments: { id: string; file: { name: string; size: number } }[];
  };
}) {
  return (
    <MultipartForm endpoint="/api/posts" redirectBase="/forum/" imagesOnly>
      <input type="hidden" name="id" value={post?.id || ""} />
      <label>
        帖子标题
        <input
          name="title"
          required
          minLength={2}
          maxLength={120}
          defaultValue={post?.title}
          placeholder="一个清晰的问题，或一个值得分享的发现"
        />
      </label>
      <label>
        讨论分类
        <select name="categoryId" defaultValue={post?.categoryId || ""} required>
          <option value="" disabled>
            选择讨论分类
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        正文
        <textarea
          name="body"
          required
          minLength={10}
          maxLength={20000}
          rows={10}
          defaultValue={post?.body}
          placeholder="描述你的问题、经验或想法（至少 10 个字）"
        />
      </label>
      {post?.attachments.length ? (
        <div>
          <p>已有图片（勾选后删除）</p>
          <ImageGallery images={post.attachments} />
          {post.attachments.map((image) => (
            <label key={image.id} className="checkbox-label">
              <input type="checkbox" name="removeIds" value={image.id} />
              删除 {image.file.name}
            </label>
          ))}
        </div>
      ) : null}
      <ImageInput />
      <div>
        <Button>{post ? "保存修改" : "发布帖子"}</Button>
      </div>
      <p className="inline-note">内容仅审批通过的成员可见，发布后立即展示。</p>
    </MultipartForm>
  );
}
