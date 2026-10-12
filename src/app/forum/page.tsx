import Link from "next/link";
import { Plus, Search, MessageCircle } from "lucide-react";
import { db } from "@/lib/db";
import { memberPage } from "@/lib/session";
import { date } from "@/lib/utils";
import { PageHeading, EmptyState, Pagination } from "@/components/common";
import { Button } from "@/components/ui/button";
export default async function Forum({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await memberPage();
  const params = await searchParams;
  const where = {
    deletedAt: null,
    ...(params.category ? { categoryId: params.category } : {}),
    ...(params.q?.trim() ? { title: { contains: params.q.trim().slice(0, 100) } } : {}),
  };
  const count = await db.post.count({ where });
  const page = Math.min(
    Math.max(1, Math.trunc(Number(params.page) || 1)),
    Math.max(1, Math.ceil(count / 15)),
  );
  const [posts, categories] = await Promise.all([
    db.post.findMany({
      where,
      include: {
        author: { select: { name: true } },
        category: true,
        _count: { select: { replies: { where: { deletedAt: null } } } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * 15,
      take: 15,
    }),
    db.category.findMany({ where: { kind: "POST" } }),
  ]);
  return (
    <>
      <PageHeading
        eyebrow="GOOD QUESTIONS. SHARED IDEAS."
        title="讨论广场"
        description="交流学习方法，寻找问题答案，也分享一路上的小发现。"
        action={
          <Button asChild>
            <Link href="/forum/new">
              <Plus size={16} />
              发起讨论
            </Link>
          </Button>
        }
      />
      <form className="filter-bar">
        <div className="search-field">
          <Search size={17} />
          <input
            name="q"
            aria-label="搜索帖子"
            defaultValue={params.q}
            placeholder="搜索讨论标题…"
            maxLength={100}
          />
        </div>
        <select name="category" aria-label="讨论分类" defaultValue={params.category || ""}>
          <option value="">全部分类</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <Button variant="outline">筛选</Button>
      </form>
      {posts.length ? (
        <div className="post-list">
          {posts.map((post) => (
            <Link key={post.id} className="post-card" href={`/forum/${post.id}`}>
              <span className="badge badge-member">{post.category.name}</span>
              <h3>{post.title}</h3>
              <p className="card-description">{post.body}</p>
              <div className="post-meta">
                <span>{post.author.name}</span>
                <span>{date(post.createdAt)}</span>
                <span className="push-right">
                  <MessageCircle size={12} style={{ display: "inline", marginRight: 5 }} />
                  {post._count.replies} 条回复
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          title="聊聊最近的学习吧"
          description="一个问题、一点经验，都值得在这里认真交流。"
          href="/forum/new"
          label="发起第一个讨论"
        />
      )}
      <Pagination page={page} pages={Math.ceil(count / 15)} base="/forum" query={params} />
    </>
  );
}
