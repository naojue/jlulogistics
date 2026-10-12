import { MessageCircle } from "lucide-react";
import { discussionDeleteAction } from "@/app/actions";
import { MultipartForm } from "@/components/multipart-form";
import { ImageInput } from "@/components/image-input";
import { ImageGallery } from "@/components/image-gallery";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { date } from "@/lib/utils";
type Item = {
  id: string;
  body: string;
  parentId: string | null;
  authorId: string;
  author: { name: string };
  createdAt: Date;
  attachments: { id: string; file: { name: string } }[];
};
export function Discussion({
  kind,
  id,
  items,
  userId,
  admin,
}: {
  kind: "RESOURCE" | "POST";
  id: string;
  items: Item[];
  userId: string;
  admin: boolean;
}) {
  function form(parentId?: string) {
    return (
      <MultipartForm endpoint={`/api/discussions/${kind}/${id}`} reset imagesOnly>
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="parentId" value={parentId || ""} />
        <label>
          {parentId ? "回复内容" : "分享你的想法"}
          <textarea
            name="body"
            required
            maxLength={3000}
            rows={parentId ? 2 : 3}
            placeholder="认真交流，让彼此的学习更进一步。"
          />
        </label>
        <ImageInput />
        <div>
          <Button size="sm">
            {parentId ? "提交回复" : "发布留言"}
            <MessageCircle size={14} />
          </Button>
        </div>
      </MultipartForm>
    );
  }
  function itemView(item: Item, nested = false) {
    return (
      <div className="discussion-item" key={item.id}>
        <div className="discussion-header">
          <span className="avatar avatar-small">{item.author.name.slice(0, 1)}</span>
          <strong>{item.author.name}</strong>
          <small>{date(item.createdAt)}</small>
        </div>
        <p className="discussion-body">{item.body}</p>
        <ImageGallery images={item.attachments} />
        {(admin || item.authorId === userId) && (
          <details>
            <summary>管理这条留言</summary>
            <ActionForm action={discussionDeleteAction} className="mini-form">
              <input type="hidden" name="kind" value={kind === "RESOURCE" ? "COMMENT" : "REPLY"} />
              <input type="hidden" name="id" value={item.id} />
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
              {form(item.id)}
            </details>
            <div className="discussion-children">
              {items
                .filter((child) => child.parentId === item.id)
                .map((child) => itemView(child, true))}
            </div>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="panel">
      <h2>
        一起讨论 <span className="muted">{items.length} 条留言</span>
      </h2>
      {form()}
      {items.length ? (
        items.filter((item) => !item.parentId).map((item) => itemView(item))
      ) : (
        <p className="inline-note">还没有留言，来分享第一个想法吧。</p>
      )}
    </div>
  );
}
