import Link from "next/link";
import { db } from "@/lib/db";
import { memberPage } from "@/lib/session";
import { PageHeading, EmptyState, Pagination } from "@/components/common";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { discussionDeleteAction } from "@/app/actions";
export default async function Discussions({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await memberPage(true);
  const params = await searchParams;
  const kind = ["COMMENT", "REPLY"].includes(params.kind || "") ? params.kind : "POST";
  const condition = {
    deletedAt: null,
    ...(params.q
      ? kind === "POST"
        ? {
            OR: [
              { title: { contains: params.q.slice(0, 100) } },
              { body: { contains: params.q.slice(0, 100) } },
            ],
          }
        : { body: { contains: params.q.slice(0, 100) } }
      : {}),
  };
  const count =
    kind === "POST"
      ? await db.post.count({ where: condition })
      : kind === "COMMENT"
        ? await db.resourceComment.count({ where: { ...condition, resource: { deletedAt: null } } })
        : await db.postReply.count({ where: { ...condition, post: { deletedAt: null } } });
  const page = Math.min(
    Math.max(1, Math.trunc(Number(params.page) || 1)),
    Math.max(1, Math.ceil(count / 20)),
  );
  const options = { orderBy: { createdAt: "desc" as const }, skip: (page - 1) * 20, take: 20 };
  const items =
    kind === "POST"
      ? (
          await db.post.findMany({
            where: condition,
            ...options,
            include: { author: { select: { name: true } } },
          })
        ).map((item) => ({ ...item, href: `/forum/${item.id}`, text: item.title }))
      : kind === "COMMENT"
        ? (
            await db.resourceComment.findMany({
              where: { ...condition, resource: { deletedAt: null } },
              ...options,
              include: { author: { select: { name: true } } },
            })
          ).map((item) => ({ ...item, href: `/resources/${item.resourceId}`, text: item.body }))
        : (
            await db.postReply.findMany({
              where: { ...condition, post: { deletedAt: null } },
              ...options,
              include: { author: { select: { name: true } } },
            })
          ).map((item) => ({ ...item, href: `/forum/${item.postId}`, text: item.body }));
  return (
    <>
      <PageHeading
        eyebrow="KEEP CONVERSATIONS THOUGHTFUL"
        title="讨论管理"
        description="帖子、资料评论和帖子回复分别管理，删除操作会记录原因。"
      />
      <form className="filter-bar">
        <input name="q" defaultValue={params.q} aria-label="搜索讨论内容" placeholder="搜索内容" />
        <select name="kind" defaultValue={kind} aria-label="内容类型">
          <option value="POST">帖子</option>
          <option value="COMMENT">资料评论</option>
          <option value="REPLY">帖子回复</option>
        </select>
        <Button variant="outline">筛选</Button>
      </form>
      <div className="panel table-wrapper">
        {items.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>内容</th>
                <th>作者</th>
                <th>管理</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link className="text-link" href={item.href}>
                      {item.text.slice(0, 150)}
                    </Link>
                    {kind === "POST" && (
                      <p>
                        <Link className="text-link" href={`${item.href}/edit`}>
                          编辑帖子
                        </Link>
                      </p>
                    )}
                  </td>
                  <td>{item.author.name}</td>
                  <td>
                    <ActionForm action={discussionDeleteAction} className="mini-form">
                      <input type="hidden" name="kind" value={kind} />
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
          <EmptyState title="暂无匹配内容" />
        )}
      </div>
      <Pagination
        page={page}
        pages={Math.ceil(count / 20)}
        base="/admin/discussions"
        query={params}
      />
    </>
  );
}
