import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { memberPage } from "@/lib/session";
import { PageHeading } from "@/components/common";
import { PostForm } from "@/components/post-form";
import { attachmentSelect } from "@/services/media";
export default async function EditPost({ params }: { params: Promise<{ id: string }> }) {
  const user = await memberPage();
  const { id } = await params;
  const post = await db.post.findFirst({
    where: { id, deletedAt: null },
    include: { attachments: { select: attachmentSelect, orderBy: { position: "asc" } } },
  });
  if (!post || (post.authorId !== user.id && !["ADMIN", "SUPER_ADMIN"].includes(user.role)))
    notFound();
  const categories = await db.category.findMany({ where: { kind: "POST" } });
  return (
    <div className="narrow">
      <PageHeading eyebrow="KEEP YOUR IDEAS GROWING" title="编辑讨论" />
      <div className="panel">
        <PostForm post={post} categories={categories} />
      </div>
    </div>
  );
}
