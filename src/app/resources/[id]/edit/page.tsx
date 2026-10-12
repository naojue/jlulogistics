import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { memberPage } from "@/lib/session";
import { PageHeading } from "@/components/common";
import { ResourceForm } from "@/components/resource-form";
export default async function Edit({ params }: { params: Promise<{ id: string }> }) {
  const user = await memberPage();
  const { id } = await params;
  const resource = await db.resource.findFirst({
    where: { id, deletedAt: null },
    include: { tags: true },
  });
  if (!resource || (resource.authorId !== user.id && !["ADMIN", "SUPER_ADMIN"].includes(user.role)))
    notFound();
  const [categories, tags] = await Promise.all([
    db.category.findMany({ where: { kind: "RESOURCE" } }),
    db.tag.findMany(),
  ]);
  return (
    <div className="narrow">
      <PageHeading
        eyebrow="REFINE YOUR SHARE"
        title="编辑资料信息"
        description="修改标题、简介、分类与标签。更换文件请重新发布资料。"
      />
      <div className="panel">
        <ResourceForm
          resource={resource}
          admin={["ADMIN", "SUPER_ADMIN"].includes(user.role)}
          categories={categories}
          tags={tags}
        />
      </div>
    </div>
  );
}
