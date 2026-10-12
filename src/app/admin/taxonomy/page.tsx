import { db } from "@/lib/db";
import { memberPage } from "@/lib/session";
import { PageHeading } from "@/components/common";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { taxonomyAction, taxonomyDeleteAction } from "@/app/actions";
export default async function Taxonomy() {
  await memberPage(true);
  const [categories, tags] = await Promise.all([
    db.category.findMany({ orderBy: { name: "asc" } }),
    db.tag.findMany({ orderBy: { name: "asc" } }),
  ]);
  const groups = [
    {
      kind: "RESOURCE",
      label: "资料分类",
      items: categories.filter((item) => item.kind === "RESOURCE"),
    },
    { kind: "POST", label: "讨论分类", items: categories.filter((item) => item.kind === "POST") },
    { kind: "TAG", label: "资料标签", items: tags },
  ];
  return (
    <>
      <PageHeading
        eyebrow="MAKE KNOWLEDGE EASY TO FIND"
        title="分类与标签"
        description="成员从这里维护的分类与标签中选择，已被内容使用的项不能直接删除。"
      />
      <div className="taxonomy-grid">
        {groups.map((group) => (
          <section className="panel" key={group.kind}>
            <h2>{group.label}</h2>
            {group.items.map((item) => (
              <div className="taxonomy-item" key={item.id}>
                <ActionForm action={taxonomyAction} className="mini-form">
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="kind" value={group.kind} />
                  <input
                    name="name"
                    defaultValue={item.name}
                    maxLength={30}
                    required
                    aria-label="分类或标签名称"
                  />
                  <Button size="sm" variant="outline">
                    修改
                  </Button>
                </ActionForm>
                <ActionForm action={taxonomyDeleteAction} className="mini-form">
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="kind" value={group.kind} />
                  <Button size="sm" variant="ghost">
                    删除
                  </Button>
                </ActionForm>
              </div>
            ))}
            <ActionForm action={taxonomyAction} className="mini-form">
              <input type="hidden" name="kind" value={group.kind} />
              <input
                name="name"
                placeholder="新增名称"
                maxLength={30}
                required
                aria-label="新增名称"
              />
              <Button size="sm">添加</Button>
            </ActionForm>
          </section>
        ))}
      </div>
    </>
  );
}
