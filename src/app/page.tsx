import Link from "next/link";
import { ArrowUpRight, LibraryBig, Users, FolderOpen, Search } from "lucide-react";
import { db } from "@/lib/db";
import { listResources } from "@/services/resources";
import { Button } from "@/components/ui/button";
import { ResourceCard, EmptyState, Pagination } from "@/components/common";
import { SupplyChainArt } from "@/components/supply-chain-art";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const [{ items, count, page, pages }, categories, tags, total, members] = await Promise.all([
    listResources({ ...params, page: Number(params.page) || 1 }),
    db.category.findMany({ where: { kind: "RESOURCE" }, orderBy: { name: "asc" } }),
    db.tag.findMany({ orderBy: { name: "asc" } }),
    db.resource.count({ where: { deletedAt: null } }),
    db.user.count({ where: { status: "ACTIVE", emailVerified: true } }),
  ]);
  const areaLink = (area?: string) => {
    const query = new URLSearchParams();
    for (const key of ["q", "category", "tag"]) if (params[key]) query.set(key, params[key]!);
    if (area) query.set("area", area);
    return `/?${query}`;
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">JIDA LOGISTICS / KNOWLEDGE HUB</p>
          <h1>发现好资料，让学习更进一步</h1>
          <p className="muted">从课堂笔记到供应链实践，和吉大物流伙伴一起积累。</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/upload">
            分享资料 <ArrowUpRight size={16} />
          </Link>
        </Button>
      </div>
      <section className="hero">
        <div>
          <div className="hero-label">
            <span className="status-dot" /> 吉大物流 · 共同学习计划
          </div>
          <h1>
            让知识流动，
            <br />
            让成长<em>彼此连接。</em>
          </h1>
          <p>
            分享物流与供应链的每一次发现，
            <br />
            让一份笔记，成为我们共同向前的起点。
          </p>
          <div className="hero-actions">
            <Button asChild>
              <Link href="/register">
                加入学习社区 <ArrowUpRight size={15} />
              </Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/forum">去讨论广场 →</Link>
            </Button>
          </div>
        </div>
        <SupplyChainArt />
      </section>
      <div className="metrics">
        <div className="metric">
          <div className="metric-icon">
            <LibraryBig size={21} />
          </div>
          <div>
            <strong>{total}</strong>
            <small>份资料，持续积累</small>
          </div>
        </div>
        <div className="metric">
          <div className="metric-icon">
            <Users size={21} />
          </div>
          <div>
            <strong>{members}</strong>
            <small>位成员，共同学习</small>
          </div>
        </div>
        <div className="metric">
          <div className="metric-icon">
            <FolderOpen size={21} />
          </div>
          <div>
            <strong>{categories.length}</strong>
            <small>个领域，等待探索</small>
          </div>
        </div>
      </div>
      <section>
        <div className="section-title">
          <div>
            <h2>
              探索资料库 <small>{count} 份资料 · 最新发布优先</small>
            </h2>
          </div>
          <div className="tabs">
            <Link className={`tab ${!params.area ? "active" : ""}`} href={areaLink()}>
              全部资料
            </Link>
            <Link
              className={`tab ${params.area === "MEMBER" ? "active" : ""}`}
              href={areaLink("MEMBER")}
            >
              成员分享
            </Link>
            <Link
              className={`tab ${params.area === "ADMIN" ? "active" : ""}`}
              href={areaLink("ADMIN")}
            >
              管理员资料
            </Link>
          </div>
        </div>
        <form className="filter-bar">
          <input type="hidden" name="area" value={params.area || ""} />
          <div className="search-field">
            <Search size={17} />
            <input
              aria-label="搜索资料"
              name="q"
              defaultValue={params.q}
              placeholder="搜索资料标题或简介…"
              maxLength={100}
            />
          </div>
          <select name="category" aria-label="资料分类" defaultValue={params.category || ""}>
            <option value="">全部分类</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <select name="tag" aria-label="资料标签" defaultValue={params.tag || ""}>
            <option value="">全部标签</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline">
            筛选
          </Button>
        </form>
        {items.length ? (
          <div className="resource-grid">
            {items.map((item) => (
              <ResourceCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <EmptyState
            title={
              params.q || params.category || params.tag
                ? "没有找到匹配的资料"
                : "第一份分享，从你开始"
            }
            description="上传一份笔记、讲义或学习清单，让这个空间慢慢丰富起来。"
            href="/upload"
            label="上传学习资料"
          />
        )}
        <Pagination page={page} pages={pages} base="/" query={params} />
      </section>
    </>
  );
}
