import { db } from "@/lib/db";
import { memberPage } from "@/lib/session";
import { PageHeading } from "@/components/common";
import { ResourceForm } from "@/components/resource-form";
export default async function Upload() {
  const user = await memberPage();
  const [categories, tags] = await Promise.all([
    db.category.findMany({ where: { kind: "RESOURCE" } }),
    db.tag.findMany(),
  ]);
  return (
    <div className="narrow">
      <PageHeading
        eyebrow="SHARE SOMETHING USEFUL"
        title="分享一份学习资料"
        description="你的整理，可能正是另一个人需要的帮助。"
      />
      <div className="panel">
        <ResourceForm
          admin={["ADMIN", "SUPER_ADMIN"].includes(user.role)}
          categories={categories}
          tags={tags}
        />
      </div>
    </div>
  );
}
