import Link from "next/link";
import { memberPage } from "@/lib/session";
import { projectAdminList } from "@/services/projects";
import { deleteProjectAction } from "@/app/project-actions";
import { PageHeading, EmptyState, Pagination } from "@/components/common";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { projectStatusLabel } from "@/components/project-labels";

export default async function AdminProjects({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await memberPage(true);
  const params = await searchParams;
  const { items, page, pages } = await projectAdminList(user, {
    q: params.q,
    page: Number(params.page) || 1,
  });
  return (
    <>
      <PageHeading
        eyebrow="CURATE THE PROJECT LIBRARY"
        title="项目管理"
        description="管理项目介绍、版本和同步状态。删除后立即隐藏项目及其所有文件入口。"
      />
      <form className="filter-bar">
        <input
          name="q"
          defaultValue={params.q}
          aria-label="搜索项目"
          placeholder="搜索项目名称或介绍"
          maxLength={100}
        />
        <Button variant="outline">搜索</Button>
      </form>
      <div className="panel table-wrapper">
        {items.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>项目</th>
                <th>作者 / 状态</th>
                <th>管理</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link href={`/projects/${item.id}`} className="text-link">
                      {item.title}
                    </Link>
                    <small>{item.course}</small>
                  </td>
                  <td>
                    {item.author.name}
                    <small>
                      {item.latestTask
                        ? projectStatusLabel[item.latestTask.status] || item.latestTask.status
                        : item.currentVersionId
                          ? "已发布"
                          : "尚未发布"}
                    </small>
                  </td>
                  <td>
                    <Link className="text-link" href={`/projects/${item.id}/edit`}>
                      编辑与同步状态
                    </Link>
                    <ActionForm action={deleteProjectAction} className="mini-form">
                      <input type="hidden" name="id" value={item.id} />
                      <input
                        name="reason"
                        required
                        minLength={2}
                        maxLength={500}
                        placeholder="删除原因"
                        aria-label="删除原因"
                      />
                      <Button variant="destructive" size="sm">
                        删除项目
                      </Button>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="暂无项目" />
        )}
      </div>
      <Pagination page={page} pages={pages} base="/admin/projects" query={params} />
    </>
  );
}
