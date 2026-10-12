import Link from "next/link";
import { db } from "@/lib/db";
import { memberPage } from "@/lib/session";
import { listResources } from "@/services/resources";
import { PageHeading, EmptyState, Pagination } from "@/components/common";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { resourceDeleteAction } from "@/app/actions";
export default async function Resources({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await memberPage(true);
  const params = await searchParams;
  const { items, page, pages } = await listResources({ ...params, page: Number(params.page) || 1 });
  return (
    <>
      <PageHeading
        eyebrow="CURATE THE RESOURCE LIBRARY"
        title="资料管理"
        description="管理两个资料区的全部资料，编辑介绍或填写原因后删除。"
      />
      <form className="filter-bar">
        <input
          name="q"
          defaultValue={params.q}
          aria-label="搜索资料"
          placeholder="搜索资料标题或简介"
        />
        <Button variant="outline">搜索</Button>
      </form>
      <div className="panel table-wrapper">
        {items.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>资料</th>
                <th>上传者 / 发布位置</th>
                <th>管理</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link className="text-link" href={`/resources/${item.id}`}>
                      {item.title}
                    </Link>
                    <small>{item.category.name}</small>
                  </td>
                  <td>
                    {item.author.name}
                    <small>{item.area === "ADMIN" ? "管理员资料区" : "成员分享区"}</small>
                  </td>
                  <td>
                    <Link className="text-link" href={`/resources/${item.id}/edit`}>
                      编辑资料
                    </Link>
                    <ActionForm action={resourceDeleteAction} className="mini-form">
                      <input type="hidden" name="id" value={item.id} />
                      <input
                        name="reason"
                        required
                        minLength={2}
                        maxLength={500}
                        placeholder="删除原因"
                        aria-label="删除原因"
                      />
                      <Button size="sm" variant="destructive">
                        删除
                      </Button>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="暂无资料" />
        )}
      </div>
      <Pagination page={page} pages={pages} base="/admin/resources" query={params} />
    </>
  );
}
