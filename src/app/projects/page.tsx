import Link from "next/link";
import { ArrowUpRight, Search } from "lucide-react";
import { listProjects } from "@/services/projects";
import { PageHeading, EmptyState, Pagination } from "@/components/common";
import { ProjectCard } from "@/components/project-card";
import { Button } from "@/components/ui/button";

export default async function Projects({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const { items, count, page, pages, courses, tags } = await listProjects({
    ...params,
    page: Number(params.page) || 1,
  });
  return (
    <>
      <PageHeading
        eyebrow="LOGISTICS × COMPUTER SCIENCE"
        title="专业项目库"
        description="从物流问题到数据与代码，把课堂里的想法做成可以交流的项目。"
        action={
          <Button asChild>
            <Link href="/projects/new">
              发布项目 <ArrowUpRight size={16} />
            </Link>
          </Button>
        }
      />
      <div className="project-intro">
        <p>
          探索同学们的课程设计、算法实践和数据分析。项目介绍公开，代码、版本下载和讨论向审批通过的成员开放。
        </p>
      </div>
      <form className="filter-bar">
        <div className="search-field">
          <Search size={17} />
          <input
            name="q"
            defaultValue={params.q}
            maxLength={100}
            aria-label="搜索项目"
            placeholder="搜索项目名称或介绍…"
          />
        </div>
        <select name="course" defaultValue={params.course || ""} aria-label="项目课程">
          <option value="">全部课程 / 主题</option>
          {courses.map((course) => (
            <option key={course} value={course}>
              {course}
            </option>
          ))}
        </select>
        <select name="tag" defaultValue={params.tag || ""} aria-label="项目技术标签">
          <option value="">全部技术标签</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
        <Button variant="outline">筛选</Button>
      </form>
      <div className="section-title">
        <h2>
          一起实践 <small>{count} 个项目 · 最新发布优先</small>
        </h2>
      </div>
      {items.length ? (
        <div className="resource-grid">
          {items.map((item) => (
            <ProjectCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={
            params.q || params.course || params.tag
              ? "没有找到匹配的项目"
              : "第一个项目，从你的想法开始"
          }
          description="分享一份完整的项目，让问题、数据和代码连接起来。"
          href="/projects/new"
          label="发布项目"
        />
      )}
      <Pagination page={page} pages={pages} base="/projects" query={params} />
    </>
  );
}
