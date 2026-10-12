import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { memberPage } from "@/lib/session";
import { date } from "@/lib/utils";
import { discussionItems } from "@/services/discussions";
import { Discussion } from "@/components/discussion";
import { ActionForm } from "@/components/action-form";
import { discussionDeleteAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { ImageGallery } from "@/components/image-gallery";
import { attachmentSelect } from "@/services/media";
export default async function PostDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await memberPage();
  const { id } = await params;
  const post = await db.post.findFirst({
    where: { id, deletedAt: null },
    include: {
      author: { select: { name: true } },
      category: true,
      attachments: { select: attachmentSelect, orderBy: { position: "asc" } },
    },
  });
  if (!post) notFound();
  const items = await discussionItems(user, "POST", id);
  const admin = ["ADMIN", "SUPER_ADMIN"].includes(user.role);
  const canEdit = admin || user.id === post.authorId;
  return (
    <div className="narrow">
      <Link className="back-link" href="/forum">
        <ArrowLeft size={15} />
        返回讨论广场
      </Link>
      <article className="panel">
        <span className="badge badge-member">{post.category.name}</span>
        <h1 className="detail-title">{post.title}</h1>
        <div className="detail-meta">
          <span className="avatar avatar-small">{post.author.name.slice(0, 1)}</span>
          <span>{post.author.name}</span>
          <span>{date(post.createdAt)}</span>
          {canEdit && (
            <Link href={`/forum/${id}/edit`} className="text-link push-right">
              编辑帖子
            </Link>
          )}
        </div>
        <p className="prose-text">{post.body}</p>
        <ImageGallery images={post.attachments} />
        {canEdit && (
          <details className="danger-details">
            <summary>删除这篇帖子</summary>
            <ActionForm action={discussionDeleteAction}>
              <input type="hidden" name="kind" value="POST" />
              <input type="hidden" name="id" value={id} />
              {user.id !== post.authorId && (
                <label>
                  删除原因
                  <input name="reason" required minLength={2} maxLength={500} />
                </label>
              )}
              <div>
                <Button variant="destructive" size="sm">
                  确认删除帖子
                </Button>
              </div>
            </ActionForm>
          </details>
        )}
      </article>
      <Discussion kind="POST" id={id} items={items} userId={user.id} admin={admin} />
    </div>
  );
}
