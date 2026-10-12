import { db } from "@/lib/db";
import { memberPage } from "@/lib/session";
import { PageHeading } from "@/components/common";
import { PostForm } from "@/components/post-form";
export default async function NewPost() {
  await memberPage();
  const categories = await db.category.findMany({ where: { kind: "POST" } });
  return (
    <div className="narrow">
      <PageHeading
        eyebrow="START A CONVERSATION"
        title="发起一次学习讨论"
        description="分享真实的想法，让交流从一个好问题开始。"
      />
      <div className="panel">
        <PostForm categories={categories} />
      </div>
    </div>
  );
}
